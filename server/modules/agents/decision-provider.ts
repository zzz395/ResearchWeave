import { z } from "zod";

import {
  AGENT_MAX_EVIDENCE,
  AGENT_MAX_STEPS,
  AGENT_MAX_TOOL_CALLS,
  AGENT_PROVIDER_RESPONSE_MAX_BYTES,
  agentEvidenceIdSchema,
  agentErrorCodeSchema,
  agentFinalResultSchema,
  agentObservationSchema,
  agentTaskPromptSchema,
  agentToolNameSchema,
  type AgentErrorCode,
  type AgentFinalResult,
  type AgentObservation,
  type AgentToolName,
} from "../../../shared/contracts/agents";
import type { AgentToolDescriptor } from "./tools/registry";

export const AGENT_DECISION_TIMEOUT_MAX_MS = 30_000;
export const SUBMIT_FINAL_ANSWER_ACTION_NAME = "submit_final_answer" as const;

export type AgentDecisionActionName =
  | AgentToolName
  | typeof SUBMIT_FINAL_ANSWER_ACTION_NAME;

export interface AgentDecisionCompletedToolCall {
  readonly sequence: number;
  readonly toolName: AgentToolName;
  readonly safeArguments: Readonly<Record<string, unknown>>;
  readonly observation: AgentObservation;
  readonly evidenceIds: readonly string[];
}

export interface AgentDecisionContext {
  readonly taskPrompt: string;
  readonly completedToolCalls: readonly AgentDecisionCompletedToolCall[];
}

const uniqueEvidenceIdsSchema = z
  .array(agentEvidenceIdSchema)
  .max(AGENT_MAX_EVIDENCE)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Evidence identifiers must be unique.",
  });

export const agentDecisionContextSchema: z.ZodType<AgentDecisionContext> = z
  .object({
    taskPrompt: agentTaskPromptSchema,
    completedToolCalls: z
      .array(
        z
          .object({
            sequence: z.number().int().positive().max(AGENT_MAX_STEPS),
            toolName: agentToolNameSchema,
            safeArguments: z.record(z.string(), z.json()),
            observation: agentObservationSchema,
            evidenceIds: uniqueEvidenceIdsSchema,
          })
          .strict(),
      )
      .max(AGENT_MAX_TOOL_CALLS),
  })
  .strict()
  .superRefine((context, refinementContext) => {
    let previousSequence = 0;
    const evidenceIds = new Set<string>();
    for (const [index, call] of context.completedToolCalls.entries()) {
      if (call.sequence <= previousSequence) {
        refinementContext.addIssue({
          code: "custom",
          message: "Completed tool calls must be ordered by increasing sequence.",
          path: ["completedToolCalls", index, "sequence"],
        });
      }
      previousSequence = call.sequence;
      for (const evidenceId of call.evidenceIds) {
        if (evidenceIds.has(evidenceId)) {
          refinementContext.addIssue({
            code: "custom",
            message: "Evidence identifiers must be unique across completed tool calls.",
            path: ["completedToolCalls", index, "evidenceIds"],
          });
        }
        evidenceIds.add(evidenceId);
      }
    }
  });

export interface AgentDecisionLimits {
  readonly timeoutMs: number;
  readonly maxAttempts: 1 | 2;
  readonly responseMaxBytes: number;
}

export const agentDecisionLimitsSchema: z.ZodType<AgentDecisionLimits> = z
  .object({
    timeoutMs: z.number().int().positive().max(AGENT_DECISION_TIMEOUT_MAX_MS),
    maxAttempts: z.union([z.literal(1), z.literal(2)]),
    responseMaxBytes: z
      .number()
      .int()
      .positive()
      .max(AGENT_PROVIDER_RESPONSE_MAX_BYTES),
  })
  .strict();

export interface AgentDecisionToolActionDefinition {
  readonly kind: "tool";
  readonly name: AgentToolName;
  readonly description: string;
  readonly argumentsSchema: z.ZodType<Record<string, unknown>>;
}

export interface AgentDecisionControlActionDefinition {
  readonly kind: "control";
  readonly name: typeof SUBMIT_FINAL_ANSWER_ACTION_NAME;
  readonly description: string;
  readonly argumentsSchema: typeof agentFinalResultSchema;
}

export type AgentDecisionActionDefinition =
  | AgentDecisionToolActionDefinition
  | AgentDecisionControlActionDefinition;

const submitFinalAnswerAction = Object.freeze({
  kind: "control" as const,
  name: SUBMIT_FINAL_ANSWER_ACTION_NAME,
  description:
    "Submit the final grounded answer. Cite only evidence identifiers exposed in the decision context, or use insufficient_context with no evidence identifiers.",
  argumentsSchema: agentFinalResultSchema,
});

export function createAgentDecisionActions(
  toolDescriptors: readonly AgentToolDescriptor[],
): readonly AgentDecisionActionDefinition[] {
  const names = new Set<AgentToolName>();
  const actions: AgentDecisionActionDefinition[] = [];

  for (const descriptor of toolDescriptors) {
    if (names.has(descriptor.name)) {
      throw new TypeError(`Duplicate Agent decision action name: ${descriptor.name}`);
    }
    names.add(descriptor.name);
    actions.push(
      Object.freeze({
        kind: "tool" as const,
        name: descriptor.name,
        description: descriptor.description,
        argumentsSchema: descriptor.argumentsSchema,
      }),
    );
  }

  actions.push(submitFinalAnswerAction);
  return Object.freeze(actions);
}

export interface AgentDecisionProviderInput {
  readonly promptVersion: string;
  readonly context: AgentDecisionContext;
  readonly offeredActions: readonly AgentDecisionActionDefinition[];
  readonly limits: AgentDecisionLimits;
  readonly signal: AbortSignal;
}

export type AgentDecision =
  | {
      readonly kind: "tool_call";
      readonly toolName: AgentToolName;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "final_answer";
      readonly result: AgentFinalResult;
    };

export interface AgentDecisionProvider {
  readonly model: string;
  decide(input: AgentDecisionProviderInput): Promise<AgentDecision>;
}

const providerErrorCodes = new Set<AgentErrorCode>([
  "agent_provider_timeout",
  "agent_provider_unavailable",
  "agent_provider_rejected",
  "agent_provider_invalid_response",
]);

export type AgentDecisionProviderErrorCode = Extract<
  AgentErrorCode,
  | "agent_provider_timeout"
  | "agent_provider_unavailable"
  | "agent_provider_rejected"
  | "agent_provider_invalid_response"
>;

const providerErrorMessages: Readonly<Record<AgentDecisionProviderErrorCode, string>> =
  Object.freeze({
    agent_provider_timeout: "The Agent decision provider timed out.",
    agent_provider_unavailable: "The Agent decision provider is unavailable.",
    agent_provider_rejected: "The Agent decision provider rejected the request.",
    agent_provider_invalid_response: "The Agent decision provider returned an invalid response.",
  });

export class AgentDecisionProviderError extends Error {
  readonly code: AgentDecisionProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: AgentDecisionProviderErrorCode, retryable = false) {
    const parsedCode = agentErrorCodeSchema.parse(code);
    if (!providerErrorCodes.has(parsedCode)) {
      throw new TypeError("Invalid Agent decision provider error code.");
    }
    super(providerErrorMessages[code]);
    this.name = "AgentDecisionProviderError";
    this.code = code;
    this.retryable = retryable;
    this.stack = undefined;
  }

  toJSON(): { code: AgentDecisionProviderErrorCode } {
    return { code: this.code };
  }
}

export function isAgentDecisionProviderError(
  error: unknown,
): error is AgentDecisionProviderError {
  return error instanceof AgentDecisionProviderError;
}
