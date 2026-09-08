import type { Logger } from "pino";
import { z } from "zod";

import {
  AGENT_CONTEXT_MAX_BYTES,
  AGENT_MAX_EVIDENCE,
  agentEvidenceIdSchema,
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

type ProviderResponseValidationStage =
  | "response_body"
  | "choice"
  | "message"
  | "function_call"
  | "final_action";

type ProviderResponseValidationReason =
  | "empty_body"
  | "byte_limit_exceeded"
  | "invalid_utf8"
  | "invalid_json"
  | "invalid_choices_shape_or_count"
  | "invalid_choice_structure"
  | "unexpected_finish_reason"
  | "invalid_message_structure"
  | "unknown_message_fields"
  | "non_empty_assistant_content"
  | "refusal_present"
  | "invalid_tool_call_count"
  | "invalid_function_call_structure"
  | "action_not_offered"
  | "arguments_invalid_json"
  | "tool_arguments_rejected"
  | "invalid_final_result_structure"
  | "evidence_ids_mismatch"
  | "citation_markers_mismatch"
  | "status_mismatch"
  | "empty_answer"
  | "invalid_result_semantics";

class ProviderResponseValidationError extends Error {
  readonly validationStage: ProviderResponseValidationStage;
  readonly validationReason: ProviderResponseValidationReason;
  readonly actionName?: string;

  constructor(
    validationStage: ProviderResponseValidationStage,
    validationReason: ProviderResponseValidationReason,
    actionName?: string,
  ) {
    super("Agent decision provider response validation failed.");
    this.name = "ProviderResponseValidationError";
    this.validationStage = validationStage;
    this.validationReason = validationReason;
    this.actionName = actionName;
    this.stack = undefined;
  }
}

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

function validationFailure(
  validationStage: ProviderResponseValidationStage,
  validationReason: ProviderResponseValidationReason,
  actionName?: string,
): ProviderResponseValidationError {
  return new ProviderResponseValidationError(validationStage, validationReason, actionName);
}

function evidenceMarkers(answer: string): string[] {
  return [...answer.matchAll(/\[(E\d+)\]/gu)].map((match) => match[1]);
}

function finalActionValidationFailure(
  rawArguments: unknown,
  actionName: string,
): ProviderResponseValidationError {
  if (
    !isRecord(rawArguments) ||
    !hasOnlyKeys(rawArguments, ["result"]) ||
    !Object.prototype.hasOwnProperty.call(rawArguments, "result")
  ) {
    return validationFailure("final_action", "invalid_final_result_structure", actionName);
  }

  const result = rawArguments.result;
  if (
    !isRecord(result) ||
    !hasOnlyKeys(result, ["status", "answer", "evidenceIds"]) ||
    !Object.prototype.hasOwnProperty.call(result, "status") ||
    !Object.prototype.hasOwnProperty.call(result, "answer") ||
    !Object.prototype.hasOwnProperty.call(result, "evidenceIds") ||
    typeof result.answer !== "string" ||
    !Array.isArray(result.evidenceIds) ||
    result.evidenceIds.some((evidenceId) => typeof evidenceId !== "string")
  ) {
    return validationFailure("final_action", "invalid_final_result_structure", actionName);
  }

  if (result.status !== "answered" && result.status !== "insufficient_context") {
    return validationFailure("final_action", "status_mismatch", actionName);
  }
  if (result.answer.trim().length === 0) {
    return validationFailure("final_action", "empty_answer", actionName);
  }

  const evidenceIds = result.evidenceIds as string[];
  const evidenceIdsAreValid =
    evidenceIds.length <= AGENT_MAX_EVIDENCE &&
    evidenceIds.every((evidenceId) => agentEvidenceIdSchema.safeParse(evidenceId).success) &&
    new Set(evidenceIds).size === evidenceIds.length;
  if (
    !evidenceIdsAreValid ||
    (result.status === "answered" && evidenceIds.length === 0) ||
    (result.status === "insufficient_context" && evidenceIds.length !== 0)
  ) {
    return validationFailure("final_action", "evidence_ids_mismatch", actionName);
  }

  const markers = evidenceMarkers(result.answer);
  const uniqueMarkers = markers.filter((marker, index) => markers.indexOf(marker) === index);
  if (
    (result.status === "answered" &&
      uniqueMarkers.join("\u0000") !== evidenceIds.join("\u0000")) ||
    (result.status === "insufficient_context" && markers.length > 0)
  ) {
    return validationFailure("final_action", "citation_markers_mismatch", actionName);
  }

  return validationFailure("final_action", "invalid_result_semantics", actionName);
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
      throw validationFailure("response_body", "byte_limit_exceeded");
    }
  }

  if (!response.body) throw validationFailure("response_body", "empty_body");
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
      throw validationFailure("response_body", "byte_limit_exceeded");
    }
    chunks.push(result.value);
  }

  if (byteLength === 0) throw validationFailure("response_body", "empty_body");
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
    throw validationFailure("response_body", "invalid_utf8");
  }
  if (text.trim().length === 0) throw validationFailure("response_body", "empty_body");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw validationFailure("response_body", "invalid_json");
  }
}

function parseDecision(
  envelope: unknown,
  preparedActions: readonly PreparedAction[],
): AgentDecision {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
    throw validationFailure("choice", "invalid_choices_shape_or_count");
  }
  const choices: unknown[] = envelope.choices;
  const choice: unknown = choices[0];
  if (
    !isRecord(choice) ||
    !hasOnlyKeys(choice, ["index", "message", "finish_reason", "logprobs"]) ||
    (choice.index !== undefined &&
      (typeof choice.index !== "number" || !Number.isInteger(choice.index))) ||
    (choice.logprobs !== undefined && choice.logprobs !== null)
  ) {
    throw validationFailure("choice", "invalid_choice_structure");
  }
  if (choice.finish_reason !== "tool_calls") {
    throw validationFailure("choice", "unexpected_finish_reason");
  }
  if (!isRecord(choice.message)) {
    throw validationFailure("message", "invalid_message_structure");
  }
  const message = choice.message;
  if (!hasOnlyKeys(message, [
      "role",
      "content",
      "refusal",
      "annotations",
      "audio",
      "function_call",
      "tool_calls",
    ])) {
    throw validationFailure("message", "unknown_message_fields");
  }
  if (
    message.role !== "assistant" ||
    (message.annotations !== undefined &&
      message.annotations !== null &&
      !Array.isArray(message.annotations)) ||
    (message.audio !== undefined && message.audio !== null) ||
    (message.function_call !== undefined && message.function_call !== null)
  ) {
    throw validationFailure("message", "invalid_message_structure");
  }
  if (message.refusal !== undefined && message.refusal !== null) {
    throw validationFailure("message", "refusal_present");
  }
  if (
    message.content !== undefined &&
    message.content !== null &&
    typeof message.content !== "string"
  ) {
    throw validationFailure("message", "invalid_message_structure");
  }
  if (typeof message.content === "string" && message.content.trim().length > 0) {
    throw validationFailure("message", "non_empty_assistant_content");
  }
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) {
    throw validationFailure("message", "invalid_tool_call_count");
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
    throw validationFailure("function_call", "invalid_function_call_structure");
  }
  const functionCall = call.function;
  if (
    !hasOnlyKeys(functionCall, ["name", "arguments"]) ||
    typeof functionCall.name !== "string" ||
    typeof functionCall.arguments !== "string"
  ) {
    throw validationFailure("function_call", "invalid_function_call_structure");
  }

  const action = preparedActions.find(
    (candidate) => candidate.definition.name === functionCall.name,
  )?.definition;
  if (!action) {
    throw validationFailure("function_call", "action_not_offered", "unrecognized");
  }

  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(functionCall.arguments) as unknown;
  } catch {
    throw validationFailure("function_call", "arguments_invalid_json", action.name);
  }
  if (action.kind === "control") {
    const parsedProviderArguments = submitFinalAnswerProviderArgumentsSchema.safeParse(rawArguments);
    if (!parsedProviderArguments.success) {
      throw finalActionValidationFailure(rawArguments, action.name);
    }
    const parsedResult = action.argumentsSchema.safeParse(parsedProviderArguments.data.result);
    if (!parsedResult.success) {
      throw validationFailure(
        "final_action",
        "invalid_result_semantics",
        action.name,
      );
    }
    return recursivelyFreeze({ kind: "final_answer" as const, result: parsedResult.data });
  }
  const parsedArguments = action.argumentsSchema.safeParse(rawArguments);
  if (!parsedArguments.success || !isRecord(parsedArguments.data)) {
    throw validationFailure("function_call", "tool_arguments_rejected", action.name);
  }
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
          contextResult.data.completedToolCalls.length,
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
    completedToolCallCount: number,
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
      if (error instanceof ProviderResponseValidationError) {
        try {
          this.#logger.warn(
            {
              validationStage: error.validationStage,
              validationReason: error.validationReason,
              ...(error.actionName === undefined ? {} : { actionName: error.actionName }),
              completedToolCallCount,
            },
            "Agent decision provider response validation failed",
          );
        } catch {
          // Diagnostics are best-effort and must not replace the stable provider error.
        }
        throw invalidResponse();
      }
      if (isAgentDecisionProviderError(error)) throw error;
      throw new AgentDecisionProviderError("agent_provider_unavailable", true);
    } finally {
      this.#clearTimer(timer);
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }
}
