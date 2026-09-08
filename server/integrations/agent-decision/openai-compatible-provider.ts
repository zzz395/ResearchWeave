import type { Logger } from "pino";
import { z } from "zod";

import {
  AGENT_CONTEXT_MAX_BYTES,
  agentFinalResultSchema,
  agentToolNameSchema,
} from "../../../shared/contracts/agents";
import {
  SUBMIT_FINAL_ANSWER_ACTION_NAME,
  agentDecisionContextSchema,
  agentDecisionLimitsSchema,
  AgentDecisionProviderError,
  isAgentDecisionProviderError,
  type AgentDecision,
  type AgentDecisionActionDefinition,
  type AgentDecisionProvider,
  type AgentDecisionProviderInput,
} from "../../modules/agents/decision-provider";
import {
  defaultAgentOrchestrationPromptRegistry,
  type AgentOrchestrationPromptRegistry,
} from "../../modules/agents/orchestration-prompts";

type FetchImplementation = typeof fetch;
type TimerHandle = ReturnType<typeof setTimeout>;

export interface OpenAICompatibleAgentDecisionProviderOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly logger: Logger;
  readonly promptRegistry?: AgentOrchestrationPromptRegistry;
  readonly fetchImplementation?: FetchImplementation;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
}

interface PreparedAction {
  readonly definition: AgentDecisionActionDefinition;
  readonly providerTool: Readonly<{
    type: "function";
    function: Readonly<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }>;
}

const retryableStatuses = new Set([429, 502, 503, 504]);
const providerErrorDiagnosticMaxBytes = 4_096;
const providerErrorDiagnosticReadTimeoutMs = 250;
const providerDiagnosticValueMaxCharacters = 256;
const providerRequestIdHeaders = ["x-request-id"] as const;
const submitFinalAnswerProviderArgumentsSchema = z
  .object({ result: agentFinalResultSchema })
  .strict();
const textEncoder = new TextEncoder();
const diagnosticReadTimedOut = Symbol("diagnosticReadTimedOut");

interface ProviderErrorDiagnostics {
  readonly providerRequestId?: string;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorParam?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isActionDefinition(value: unknown): value is AgentDecisionActionDefinition {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, ["kind", "name", "description", "argumentsSchema"]) &&
    (value.kind === "tool" || value.kind === "control") &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    value.argumentsSchema instanceof z.ZodType &&
    ((value.kind === "control" &&
      value.name === SUBMIT_FINAL_ANSWER_ACTION_NAME &&
      value.argumentsSchema === agentFinalResultSchema) ||
      (value.kind === "tool" && agentToolNameSchema.safeParse(value.name).success))
  );
}

function recursivelyFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) recursivelyFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function invalidResponse(): AgentDecisionProviderError {
  return new AgentDecisionProviderError("agent_provider_invalid_response");
}

function prepareActions(
  offeredActions: readonly AgentDecisionActionDefinition[],
): readonly PreparedAction[] {
  if (!Array.isArray(offeredActions) || offeredActions.length === 0) {
    throw new TypeError("At least one Agent decision action must be offered.");
  }

  const names = new Set<string>();
  const prepared: PreparedAction[] = [];
  for (const action of offeredActions) {
    if (!isActionDefinition(action)) {
      throw new TypeError("Invalid Agent decision action definition.");
    }
    if (names.has(action.name)) {
      throw new TypeError(`Duplicate Agent decision action name: ${action.name}`);
    }
    names.add(action.name);

    let jsonSchema: unknown;
    try {
      const providerArgumentsSchema = action.kind === "control"
        ? submitFinalAnswerProviderArgumentsSchema
        : action.argumentsSchema;
      jsonSchema = z.toJSONSchema(providerArgumentsSchema, { target: "draft-7" });
    } catch {
      throw new TypeError("Agent decision action schema cannot be projected.");
    }
    if (!isRecord(jsonSchema)) {
      throw new TypeError("Agent decision action schema cannot be projected.");
    }
    const parameters = { ...jsonSchema };
    delete parameters.$schema;
    const definition = Object.freeze({ ...action }) as AgentDecisionActionDefinition;
    prepared.push(
      Object.freeze({
        definition,
        providerTool: Object.freeze({
          type: "function" as const,
          function: Object.freeze({
            name: action.name,
            description: action.description,
            parameters,
          }),
        }),
      }),
    );
  }
  return Object.freeze(prepared);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not replace the stable provider error.
  }
}

function cancelReaderBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must not replace the stable provider error.
  }
}

function cancelDiagnosticBodyBestEffort(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must not replace the stable provider error.
  }
}

function boundedDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  let containsControlCharacter = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      containsControlCharacter = true;
      break;
    }
  }
  if (
    trimmed.length === 0 ||
    trimmed.length > providerDiagnosticValueMaxCharacters ||
    containsControlCharacter
  ) {
    return undefined;
  }
  return trimmed;
}

function providerRequestId(response: Response): string | undefined {
  for (const header of providerRequestIdHeaders) {
    const value = boundedDiagnosticValue(response.headers.get(header));
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseProviderErrorDiagnostics(value: unknown): Omit<ProviderErrorDiagnostics, "providerRequestId"> {
  if (!isRecord(value) || !isRecord(value.error)) return {};
  const providerErrorType = boundedDiagnosticValue(value.error.type);
  const providerErrorCode = boundedDiagnosticValue(value.error.code);
  const providerErrorParam = boundedDiagnosticValue(value.error.param);
  return {
    ...(providerErrorType === undefined ? {} : { providerErrorType }),
    ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(providerErrorParam === undefined ? {} : { providerErrorParam }),
  };
}

async function readProviderErrorDiagnostics(
  response: Response,
  setTimer: (callback: () => void, delayMs: number) => TimerHandle,
  clearTimer: (handle: TimerHandle) => void,
): Promise<ProviderErrorDiagnostics> {
  const requestId = providerRequestId(response);
  const requestIdDiagnostics = requestId === undefined ? {} : { providerRequestId: requestId };
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (declaredBytes > providerErrorDiagnosticMaxBytes) {
      cancelDiagnosticBodyBestEffort(response);
      return requestIdDiagnostics;
    }
  }
  if (!response.body) return requestIdDiagnostics;

  const reader = response.body.getReader();
  const readBody = (async (): Promise<unknown> => {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    let completed = false;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          completed = true;
          break;
        }
        byteLength += result.value.byteLength;
        if (byteLength > providerErrorDiagnosticMaxBytes) return undefined;
        chunks.push(result.value);
      }
      if (byteLength === 0) return undefined;
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.trim().length === 0) return undefined;
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    } finally {
      if (!completed) cancelReaderBestEffort(reader);
    }
  })();

  let timer!: TimerHandle;
  const readDeadline = new Promise<typeof diagnosticReadTimedOut>((resolve) => {
    timer = setTimer(() => {
      cancelReaderBestEffort(reader);
      resolve(diagnosticReadTimedOut);
    }, providerErrorDiagnosticReadTimeoutMs);
  });
  try {
    const body = await Promise.race([readBody, readDeadline]);
    if (body === diagnosticReadTimedOut) return requestIdDiagnostics;
    return { ...requestIdDiagnostics, ...parseProviderErrorDiagnostics(body) };
  } finally {
    clearTimer(timer);
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (declaredBytes > maxBytes) {
      await cancelBody(response);
      throw invalidResponse();
    }
  }

  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best-effort and must not replace the stable size error.
      }
      throw invalidResponse();
    }
    chunks.push(result.value);
  }

  if (byteLength === 0) throw invalidResponse();
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidResponse();
  }
  if (text.trim().length === 0) throw invalidResponse();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function parseDecision(
  envelope: unknown,
  preparedActions: readonly PreparedAction[],
): AgentDecision {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
    throw invalidResponse();
  }
  const choices: unknown[] = envelope.choices;
  const choice: unknown = choices[0];
  if (
    !isRecord(choice) ||
    !hasOnlyKeys(choice, ["index", "message", "finish_reason", "logprobs"]) ||
    (choice.index !== undefined &&
      (typeof choice.index !== "number" || !Number.isInteger(choice.index))) ||
    (choice.logprobs !== undefined && choice.logprobs !== null) ||
    choice.finish_reason !== "tool_calls" ||
    !isRecord(choice.message)
  ) {
    throw invalidResponse();
  }
  const message = choice.message;
  if (
    !hasOnlyKeys(message, [
      "role",
      "content",
      "refusal",
      "annotations",
      "audio",
      "function_call",
      "tool_calls",
    ]) ||
    message.role !== "assistant" ||
    (message.refusal !== undefined && message.refusal !== null) ||
    (message.annotations !== undefined &&
      message.annotations !== null &&
      !Array.isArray(message.annotations)) ||
    (message.audio !== undefined && message.audio !== null) ||
    (message.function_call !== undefined && message.function_call !== null) ||
    (message.content !== undefined &&
      message.content !== null &&
      (typeof message.content !== "string" || message.content.trim().length > 0)) ||
    !Array.isArray(message.tool_calls) ||
    message.tool_calls.length !== 1
  ) {
    throw invalidResponse();
  }

  const toolCalls: unknown[] = message.tool_calls;
  const call: unknown = toolCalls[0];
  if (
    !isRecord(call) ||
    !hasOnlyKeys(call, ["id", "type", "function"]) ||
    typeof call.id !== "string" ||
    call.id.length === 0 ||
    call.type !== "function" ||
    !isRecord(call.function)
  ) {
    throw invalidResponse();
  }
  const functionCall = call.function;
  if (
    !hasOnlyKeys(functionCall, ["name", "arguments"]) ||
    typeof functionCall.name !== "string" ||
    typeof functionCall.arguments !== "string"
  ) {
    throw invalidResponse();
  }

  const action = preparedActions.find(
    (candidate) => candidate.definition.name === functionCall.name,
  )?.definition;
  if (!action) throw invalidResponse();

  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(functionCall.arguments) as unknown;
  } catch {
    throw invalidResponse();
  }
  if (action.kind === "control") {
    const parsedProviderArguments = submitFinalAnswerProviderArgumentsSchema.safeParse(rawArguments);
    if (!parsedProviderArguments.success) throw invalidResponse();
    const parsedResult = action.argumentsSchema.safeParse(parsedProviderArguments.data.result);
    if (!parsedResult.success) throw invalidResponse();
    return recursivelyFreeze({ kind: "final_answer" as const, result: parsedResult.data });
  }
  const parsedArguments = action.argumentsSchema.safeParse(rawArguments);
  if (!parsedArguments.success || !isRecord(parsedArguments.data)) throw invalidResponse();
  return recursivelyFreeze({
    kind: "tool_call" as const,
    toolName: action.name,
    arguments: parsedArguments.data,
  });
}

export class OpenAICompatibleAgentDecisionProvider implements AgentDecisionProvider {
  readonly model: string;
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #logger: Logger;
  readonly #promptRegistry: AgentOrchestrationPromptRegistry;
  readonly #fetch: FetchImplementation;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;

  constructor(options: OpenAICompatibleAgentDecisionProviderOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
    const apiKey = options.apiKey.trim();
    const model = options.model.trim();
    if (!baseUrl || !apiKey || !model) {
      throw new TypeError("OpenAI-compatible Agent provider configuration is incomplete.");
    }
    this.model = model;
    this.#endpoint = `${baseUrl}/chat/completions`;
    this.#apiKey = apiKey;
    this.#logger = options.logger;
    this.#promptRegistry =
      options.promptRegistry ?? defaultAgentOrchestrationPromptRegistry;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
  }

  async decide(input: AgentDecisionProviderInput): Promise<AgentDecision> {
    if (input.signal.aborted) throw input.signal.reason;

    const contextResult = agentDecisionContextSchema.safeParse(input.context);
    const limitsResult = agentDecisionLimitsSchema.safeParse(input.limits);
    if (!contextResult.success || !limitsResult.success) {
      throw new TypeError("Invalid Agent decision provider input.");
    }
    const prompt = this.#promptRegistry.get(input.promptVersion);
    if (!prompt) {
      throw new AgentDecisionProviderError("agent_provider_unavailable");
    }
    const preparedActions = prepareActions(input.offeredActions);
    const contextJson = JSON.stringify(contextResult.data);
    if (textEncoder.encode(contextJson).byteLength > AGENT_CONTEXT_MAX_BYTES) {
      throw new TypeError("Agent decision context exceeds the UTF-8 byte limit.");
    }

    const requestBody = JSON.stringify({
      model: this.model,
      stream: false,
      n: 1,
      messages: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: contextJson },
      ],
      tools: preparedActions.map((action) => action.providerTool),
      tool_choice: "required",
      parallel_tool_calls: false,
    });

    let lastError: AgentDecisionProviderError | undefined;
    for (let attempt = 1; attempt <= limitsResult.data.maxAttempts; attempt += 1) {
      if (input.signal.aborted) throw input.signal.reason;
      try {
        return await this.#attempt(
          requestBody,
          preparedActions,
          limitsResult.data.timeoutMs,
          limitsResult.data.responseMaxBytes,
          input.signal,
          attempt,
        );
      } catch (error: unknown) {
        if (input.signal.aborted) throw input.signal.reason;
        if (!isAgentDecisionProviderError(error)) throw error;
        lastError = error;
        if (!error.retryable || attempt === limitsResult.data.maxAttempts) throw error;
      }
    }
    throw lastError ?? new AgentDecisionProviderError("agent_provider_unavailable");
  }

  async #attempt(
    requestBody: string,
    preparedActions: readonly PreparedAction[],
    timeoutMs: number,
    responseMaxBytes: number,
    callerSignal: AbortSignal,
    attempt: number,
  ): Promise<AgentDecision> {
    const attemptController = new AbortController();
    let timedOut = false;
    let providerHttpFailureClassified = false;
    const onCallerAbort = () => attemptController.abort(callerSignal.reason);
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    const timer = this.#setTimer(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: requestBody,
        signal: attemptController.signal,
      });
      if (callerSignal.aborted) throw callerSignal.reason;
      if (!response.ok) {
        providerHttpFailureClassified = true;
        let diagnostics: ProviderErrorDiagnostics = {};
        try {
          diagnostics = await readProviderErrorDiagnostics(
            response,
            this.#setTimer,
            this.#clearTimer,
          );
        } catch {
          cancelDiagnosticBodyBestEffort(response);
        }
        try {
          this.#logger.warn(
            { providerHttpStatus: response.status, attempt, ...diagnostics },
            "Agent decision provider HTTP failure",
          );
        } catch {
          // Diagnostics are best-effort and must not replace the stable provider error.
        }
        if (retryableStatuses.has(response.status)) {
          throw new AgentDecisionProviderError("agent_provider_unavailable", true);
        }
        throw new AgentDecisionProviderError("agent_provider_rejected");
      }
      const responseJson = await readBoundedJson(response, responseMaxBytes);
      if (callerSignal.aborted) throw callerSignal.reason;
      return parseDecision(responseJson, preparedActions);
    } catch (error: unknown) {
      if (callerSignal.aborted) throw callerSignal.reason;
      if (providerHttpFailureClassified && isAgentDecisionProviderError(error)) throw error;
      if (timedOut) {
        throw new AgentDecisionProviderError("agent_provider_timeout", true);
      }
      if (isAgentDecisionProviderError(error)) throw error;
      throw new AgentDecisionProviderError("agent_provider_unavailable", true);
    } finally {
      this.#clearTimer(timer);
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }
}
