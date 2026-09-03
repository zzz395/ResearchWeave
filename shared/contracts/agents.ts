import { z } from "zod";

export const AGENT_TASK_PROMPT_MAX_CHARACTERS = 4_000;
export const AGENT_FINAL_ANSWER_MAX_CHARACTERS = 8_000;
export const AGENT_MAX_STEPS = 8;
export const AGENT_MAX_TOOL_CALLS = 6;
export const AGENT_MAX_EVIDENCE = 32;
export const AGENT_OBSERVATION_MAX_BYTES = 32 * 1_024;
export const AGENT_CONTEXT_MAX_BYTES = 128 * 1_024;
export const AGENT_PROVIDER_RESPONSE_MAX_BYTES = 64 * 1_024;

const dateTimeSchema = z.string().datetime();
const nullableDateTimeSchema = dateTimeSchema.nullable();
const nullableUuidSchema = z.string().uuid().nullable();
const nonEmptyTextSchema = z.string().trim().min(1);

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const agentStepKindSchema = z.enum(["tool_call", "final_answer", "decision_error"]);
export const agentStepStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
export const agentEvidenceKindSchema = z.enum(["arxiv_abstract", "knowledge_chunk"]);
export const agentToolNameSchema = z.enum([
  "search_arxiv",
  "search_knowledge_base",
  "ask_knowledge",
]);
export const agentAnswerStatusSchema = z.enum(["answered", "insufficient_context"]);

export const agentErrorCodeSchema = z.enum([
  "agent_space_access_revoked",
  "agent_provider_timeout",
  "agent_provider_unavailable",
  "agent_provider_rejected",
  "agent_provider_invalid_response",
  "agent_tool_not_allowed",
  "agent_tool_invalid_arguments",
  "agent_tool_invalid_response",
  "agent_tool_timeout",
  "agent_step_limit_exceeded",
  "agent_tool_call_limit_exceeded",
  "agent_context_limit_exceeded",
  "agent_wall_time_exceeded",
  "agent_observation_too_large",
  "agent_evidence_limit_exceeded",
  "agent_invalid_final_answer",
  "agent_persistence_failed",
  "knowledge_not_indexed",
  "knowledge_embedding_incompatible",
  "research_temporarily_unavailable",
  "research_upstream_failure",
  "research_upstream_timeout",
  "answer_generation_unavailable",
  "answer_invalid_response",
  "answer_upstream_failure",
  "answer_upstream_timeout",
]);

export const agentCommandErrorCodeSchema = z.enum([
  "agent_not_found",
  "agent_task_not_found",
  "agent_run_not_found",
  "agent_runtime_unavailable",
  "agent_disabled",
  "agent_idempotency_conflict",
  "agent_retry_not_allowed",
  "agent_run_terminal",
  "invalid_agent_task_cursor",
  "space_not_found",
]);

export const agentExecutionLimitsSchema = z
  .object({
    maxSteps: z.number().int().positive().max(AGENT_MAX_STEPS),
    maxToolCalls: z.number().int().positive().max(AGENT_MAX_TOOL_CALLS),
    wallTimeSeconds: z.number().int().positive().max(180),
    providerDecisionTimeoutSeconds: z.number().int().positive().max(30),
    toolTimeoutSeconds: z.number().int().positive().max(45),
    providerAttempts: z.number().int().positive().max(2),
    providerResponseMaxBytes: z.number().int().positive().max(AGENT_PROVIDER_RESPONSE_MAX_BYTES),
    observationMaxBytes: z.number().int().positive().max(AGENT_OBSERVATION_MAX_BYTES),
    contextMaxBytes: z.number().int().positive().max(AGENT_CONTEXT_MAX_BYTES),
    finalAnswerMaxCharacters: z.number().int().positive().max(AGENT_FINAL_ANSWER_MAX_CHARACTERS),
    maxEvidence: z.number().int().positive().max(AGENT_MAX_EVIDENCE),
  })
  .strict();

export const agentDefinitionAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), reason: z.null() }).strict(),
  z
    .object({
      available: z.literal(false),
      reason: z.enum(["provider_unconfigured", "agent_disabled"]),
    })
    .strict(),
]);

export const agentDefinitionSchema = z
  .object({
    id: z.string().uuid(),
    stableKey: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u),
    name: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(1).max(2_000),
    enabled: z.boolean(),
    systemManaged: z.literal(true),
    revision: z.number().int().positive(),
    tools: z.array(agentToolNameSchema).min(1).max(3),
    limits: agentExecutionLimitsSchema,
    promptVersion: z.string().trim().min(1).max(100),
    availability: agentDefinitionAvailabilitySchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (new Set(definition.tools).size !== definition.tools.length) {
      context.addIssue({ code: "custom", message: "Agent tools must be unique.", path: ["tools"] });
    }
    if (!definition.enabled) {
      if (definition.availability.available || definition.availability.reason !== "agent_disabled") {
        context.addIssue({
          code: "custom",
          message: "A disabled Agent must report the disabled availability reason.",
          path: ["availability"],
        });
      }
      return;
    }
    if (
      definition.enabled &&
      !definition.availability.available &&
      definition.availability.reason === "agent_disabled"
    ) {
      context.addIssue({
        code: "custom",
        message: "An enabled Agent cannot use the disabled availability reason.",
        path: ["availability", "reason"],
      });
    }
  });

export const agentClientRequestIdSchema = z.string().uuid();
export const agentRequestFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const agentTaskCursorPayloadSchema = z
  .object({ createdAt: dateTimeSchema, id: z.string().uuid() })
  .strict();
export const agentTaskCursorSchema = z.string().min(1).max(256);
export const agentTaskPromptSchema = z
  .string()
  .trim()
  .min(1, "Describe the research task.")
  .max(AGENT_TASK_PROMPT_MAX_CHARACTERS, "Use no more than 4,000 characters.");

export const createAgentTaskInputSchema = z
  .object({
    agentId: z.string().uuid(),
    prompt: agentTaskPromptSchema,
    clientRequestId: agentClientRequestIdSchema,
  })
  .strict();

export const retryAgentTaskInputSchema = z
  .object({ clientRequestId: agentClientRequestIdSchema })
  .strict();

export const cancelAgentRunInputSchema = z.object({}).strict();

export const agentTaskListQuerySchema = z
  .object({
    cursor: agentTaskCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: agentRunStatusSchema.optional(),
    agentId: z.string().uuid().optional(),
  })
  .strict();

export const agentRunConfigurationSchema = z
  .object({
    agentRevision: z.number().int().positive(),
    tools: z.array(agentToolNameSchema).min(1).max(3),
    limits: agentExecutionLimitsSchema,
    promptVersion: z.string().trim().min(1).max(100),
    providerModel: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((configuration) => new Set(configuration.tools).size === configuration.tools.length, {
    message: "Agent tools must be unique.",
    path: ["tools"],
  });

export const agentEvidenceIdSchema = z.string().regex(/^E(?:[1-9]|[12][0-9]|3[0-2])$/u);

function evidenceMarkers(answer: string): string[] {
  return [...answer.matchAll(/\[(E\d+)\]/gu)].map((match) => match[1]);
}

function uniqueInOrder(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

const answeredFinalResultSchema = z
  .object({
    status: z.literal("answered"),
    answer: z.string().trim().min(1).max(AGENT_FINAL_ANSWER_MAX_CHARACTERS),
    evidenceIds: z.array(agentEvidenceIdSchema).min(1).max(AGENT_MAX_EVIDENCE),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.evidenceIds).size !== value.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Evidence identifiers must be unique.",
        path: ["evidenceIds"],
      });
    }
    if (uniqueInOrder(evidenceMarkers(value.answer)).join("\u0000") !== value.evidenceIds.join("\u0000")) {
      context.addIssue({
        code: "custom",
        message: "Answer evidence markers must match the declared evidence identifiers in order.",
        path: ["evidenceIds"],
      });
    }
  });

const insufficientContextFinalResultSchema = z
  .object({
    status: z.literal("insufficient_context"),
    answer: z.string().trim().min(1).max(AGENT_FINAL_ANSWER_MAX_CHARACTERS),
    evidenceIds: z.array(agentEvidenceIdSchema).length(0),
  })
  .strict()
  .refine((value) => evidenceMarkers(value.answer).length === 0, {
    message: "An insufficient-context answer cannot cite evidence.",
    path: ["answer"],
  });

export const agentFinalResultSchema = z.discriminatedUnion("status", [
  answeredFinalResultSchema,
  insufficientContextFinalResultSchema,
]);

const agentRunBaseShape = {
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  spaceId: z.string().uuid(),
  attemptNumber: z.number().int().positive(),
  configuration: agentRunConfigurationSchema,
  stepCount: z.number().int().nonnegative().max(AGENT_MAX_STEPS),
  toolCallCount: z.number().int().nonnegative().max(AGENT_MAX_TOOL_CALLS),
  contextBytes: z.number().int().nonnegative().max(AGENT_CONTEXT_MAX_BYTES),
  cancelRequestedAt: nullableDateTimeSchema,
  cancelRequestedByUserId: nullableUuidSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
} as const;

const activeRunBaseShape = {
  ...agentRunBaseShape,
  startedAt: dateTimeSchema,
  deadlineAt: dateTimeSchema,
} as const;

export const queuedAgentRunSchema = z
  .object({
    ...agentRunBaseShape,
    status: z.literal("queued"),
    startedAt: z.null(),
    deadlineAt: z.null(),
    finishedAt: z.null(),
    errorCode: z.null(),
    finalResult: z.null(),
  })
  .strict();

export const runningAgentRunSchema = z
  .object({
    ...activeRunBaseShape,
    status: z.literal("running"),
    finishedAt: z.null(),
    errorCode: z.null(),
    finalResult: z.null(),
  })
  .strict();

export const completedAgentRunSchema = z
  .object({
    ...activeRunBaseShape,
    status: z.literal("completed"),
    finishedAt: dateTimeSchema,
    errorCode: z.null(),
    finalResult: agentFinalResultSchema,
  })
  .strict();

export const failedAgentRunSchema = z
  .object({
    ...activeRunBaseShape,
    status: z.literal("failed"),
    finishedAt: dateTimeSchema,
    errorCode: agentErrorCodeSchema,
    finalResult: z.null(),
  })
  .strict();

export const cancelledAgentRunSchema = z
  .object({
    ...agentRunBaseShape,
    status: z.literal("cancelled"),
    startedAt: nullableDateTimeSchema,
    deadlineAt: nullableDateTimeSchema,
    finishedAt: dateTimeSchema,
    errorCode: z.null(),
    finalResult: z.null(),
  })
  .strict();

export const agentRunSchema = z.discriminatedUnion("status", [
  queuedAgentRunSchema,
  runningAgentRunSchema,
  completedAgentRunSchema,
  failedAgentRunSchema,
  cancelledAgentRunSchema,
]).superRefine((run, context) => {
  if ((run.cancelRequestedAt === null) !== (run.cancelRequestedByUserId === null)) {
    context.addIssue({
      code: "custom",
      message: "Cancellation request time and actor must either both exist or both be absent.",
      path: ["cancelRequestedAt"],
    });
  }
  if (run.toolCallCount > run.stepCount) {
    context.addIssue({
      code: "custom",
      message: "Tool-call count cannot exceed step count.",
      path: ["toolCallCount"],
    });
  }
});

export const agentTaskSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    agentId: z.string().uuid(),
    createdByUserId: nullableUuidSchema,
    prompt: agentTaskPromptSchema,
    createdAt: dateTimeSchema,
    latestRun: agentRunSchema,
  })
  .strict()
  .refine((task) => task.latestRun.taskId === task.id && task.latestRun.spaceId === task.spaceId, {
    message: "Latest run must belong to the task and Space.",
    path: ["latestRun"],
  });

const jsonObjectSchema = z.record(z.string(), z.json());
const jsonByteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const agentObservationSchema = jsonObjectSchema.refine(
  (value) => jsonByteLength(value) <= AGENT_OBSERVATION_MAX_BYTES,
  { message: "Agent observation exceeds the UTF-8 byte limit." },
);

const agentStepBaseShape = {
  id: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().positive().max(AGENT_MAX_STEPS),
  status: agentStepStatusSchema,
  executionCount: z.number().int().positive(),
  errorCode: agentErrorCodeSchema.nullable(),
  startedAt: dateTimeSchema,
  completedAt: nullableDateTimeSchema,
  durationMs: z.number().int().nonnegative().nullable(),
} as const;

const toolCallStepSchema = z
  .object({
    ...agentStepBaseShape,
    kind: z.literal("tool_call"),
    toolName: agentToolNameSchema,
    safeArguments: jsonObjectSchema,
    observation: agentObservationSchema.nullable(),
  })
  .strict();

const finalAnswerStepSchema = z
  .object({
    ...agentStepBaseShape,
    kind: z.literal("final_answer"),
    status: z.literal("completed"),
    toolName: z.null(),
    safeArguments: z.null(),
    observation: z.null(),
    errorCode: z.null(),
    completedAt: dateTimeSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const decisionErrorStepSchema = z
  .object({
    ...agentStepBaseShape,
    kind: z.literal("decision_error"),
    status: z.literal("failed"),
    toolName: z.null(),
    safeArguments: z.null(),
    observation: z.null(),
    errorCode: agentErrorCodeSchema,
    completedAt: dateTimeSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const agentStepSchema = z
  .discriminatedUnion("kind", [toolCallStepSchema, finalAnswerStepSchema, decisionErrorStepSchema])
  .superRefine((step, context) => {
    if (step.kind !== "tool_call") return;
    if (step.status === "running") {
      if (step.completedAt !== null || step.durationMs !== null || step.errorCode !== null || step.observation !== null) {
        context.addIssue({
          code: "custom",
          message: "A running tool step cannot have a result.",
        });
      }
      return;
    }
    if (step.completedAt === null || step.durationMs === null) {
      context.addIssue({ code: "custom", message: "A terminal tool step requires completion metadata." });
    }
    if (step.status === "completed" && (step.errorCode !== null || step.observation === null)) {
      context.addIssue({ code: "custom", message: "A completed tool step requires an observation and no error." });
    }
    if (step.status === "failed" && step.errorCode === null) {
      context.addIssue({ code: "custom", message: "A failed tool step requires a safe error code." });
    }
    if (step.status === "cancelled" && (step.errorCode !== null || step.observation !== null)) {
      context.addIssue({ code: "custom", message: "A cancelled tool step cannot publish a result." });
    }
  });

const evidenceBaseShape = {
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepId: z.string().uuid(),
  evidenceId: agentEvidenceIdSchema,
  excerpt: nonEmptyTextSchema,
  available: z.boolean(),
  finalOrdinal: z.number().int().positive().max(AGENT_MAX_EVIDENCE).nullable(),
  createdAt: dateTimeSchema,
} as const;

const arxivAbstractEvidenceSchema = z
  .object({
    ...evidenceBaseShape,
    kind: z.literal("arxiv_abstract"),
    paperId: nullableUuidSchema,
    canonicalArxivId: nonEmptyTextSchema.max(100),
    versionedArxivId: nonEmptyTextSchema.max(100),
    sourceVersion: z.number().int().positive(),
    title: nonEmptyTextSchema.max(1_000),
    url: z.string().url().max(2_000),
    excerpt: nonEmptyTextSchema.max(2_000),
  })
  .strict();

const knowledgeChunkEvidenceSchema = z
  .object({
    ...evidenceBaseShape,
    kind: z.literal("knowledge_chunk"),
    documentId: nullableUuidSchema,
    originalFilename: nonEmptyTextSchema.max(255),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    ordinal: z.number().int().nonnegative(),
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    excerpt: nonEmptyTextSchema.max(1_000),
  })
  .strict()
  .refine((value) => value.endOffset > value.startOffset, {
    message: "Evidence end offset must be greater than its start offset.",
    path: ["endOffset"],
  });

export const agentEvidenceSchema = z.discriminatedUnion("kind", [
  arxivAbstractEvidenceSchema,
  knowledgeChunkEvidenceSchema,
]);

export const agentDefinitionResponseSchema = z.object({ agent: agentDefinitionSchema }).strict();
export const agentDefinitionListResponseSchema = z
  .object({ agents: z.array(agentDefinitionSchema) })
  .strict();
export const agentTaskCreateResponseSchema = z
  .object({ task: agentTaskSchema, run: agentRunSchema, created: z.boolean() })
  .strict()
  .refine((response) => response.task.latestRun.id === response.run.id, {
    message: "Created run must be the task's latest run.",
    path: ["run"],
  });
export const agentTaskListResponseSchema = z
  .object({ tasks: z.array(agentTaskSchema), nextCursor: z.string().nullable() })
  .strict();
export const agentTaskResponseSchema = z
  .object({ task: agentTaskSchema, runs: z.array(agentRunSchema) })
  .strict()
  .superRefine((response, context) => {
    let previousAttempt = 0;
    for (const [index, run] of response.runs.entries()) {
      if (run.taskId !== response.task.id || run.spaceId !== response.task.spaceId) {
        context.addIssue({
          code: "custom",
          message: "Every run must belong to the task and Space.",
          path: ["runs", index],
        });
      }
      if (run.attemptNumber <= previousAttempt) {
        context.addIssue({
          code: "custom",
          message: "Task runs must be ordered by increasing attempt number.",
          path: ["runs", index, "attemptNumber"],
        });
      }
      previousAttempt = run.attemptNumber;
    }
    const latest = response.runs.at(-1);
    if (!latest || latest.id !== response.task.latestRun.id) {
      context.addIssue({
        code: "custom",
        message: "The final ordered run must be the task's latest run.",
        path: ["runs"],
      });
    }
  });
export const agentRunCreateResponseSchema = z
  .object({ run: agentRunSchema, created: z.boolean() })
  .strict();
export const agentRunResponseSchema = z.object({ run: agentRunSchema }).strict();
export const agentRunTraceResponseSchema = z
  .object({
    runId: z.string().uuid(),
    steps: z.array(agentStepSchema).max(AGENT_MAX_STEPS),
    evidence: z.array(agentEvidenceSchema).max(AGENT_MAX_EVIDENCE),
  })
  .strict()
  .superRefine((trace, context) => {
    let previousSequence = 0;
    const completedToolStepIds = new Set<string>();
    for (const [index, step] of trace.steps.entries()) {
      if (step.runId !== trace.runId) {
        context.addIssue({
          code: "custom",
          message: "Trace steps cannot cross runs.",
          path: ["steps", index, "runId"],
        });
      }
      if (step.sequence <= previousSequence) {
        context.addIssue({
          code: "custom",
          message: "Trace steps must be ordered by increasing sequence.",
          path: ["steps", index, "sequence"],
        });
      }
      previousSequence = step.sequence;
      if (step.kind === "tool_call" && step.status === "completed") {
        completedToolStepIds.add(step.id);
      }
    }

    const evidenceIds = new Set<string>();
    const finalOrdinals = new Set<number>();
    for (const [index, item] of trace.evidence.entries()) {
      if (item.runId !== trace.runId || !completedToolStepIds.has(item.stepId)) {
        context.addIssue({
          code: "custom",
          message: "Evidence must belong to this run and a completed tool step.",
          path: ["evidence", index],
        });
      }
      if (evidenceIds.has(item.evidenceId)) {
        context.addIssue({
          code: "custom",
          message: "Evidence identifiers must be unique within a run.",
          path: ["evidence", index, "evidenceId"],
        });
      }
      evidenceIds.add(item.evidenceId);
      if (item.finalOrdinal !== null) {
        if (finalOrdinals.has(item.finalOrdinal)) {
          context.addIssue({
            code: "custom",
            message: "Final evidence ordinals must be unique within a run.",
            path: ["evidence", index, "finalOrdinal"],
          });
        }
        finalOrdinals.add(item.finalOrdinal);
      }
    }
    const orderedFinalOrdinals = [...finalOrdinals].sort((left, right) => left - right);
    for (const [index, ordinal] of orderedFinalOrdinals.entries()) {
      if (ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Final evidence ordinals must form a contiguous one-based sequence.",
          path: ["evidence"],
        });
        break;
      }
    }
  });

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentStepKind = z.infer<typeof agentStepKindSchema>;
export type AgentStepStatus = z.infer<typeof agentStepStatusSchema>;
export type AgentEvidenceKind = z.infer<typeof agentEvidenceKindSchema>;
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
export type AgentAnswerStatus = z.infer<typeof agentAnswerStatusSchema>;
export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;
export type AgentCommandErrorCode = z.infer<typeof agentCommandErrorCodeSchema>;
export type AgentExecutionLimits = z.infer<typeof agentExecutionLimitsSchema>;
export type AgentDefinitionAvailability = z.infer<typeof agentDefinitionAvailabilitySchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type CreateAgentTaskInput = z.infer<typeof createAgentTaskInputSchema>;
export type RetryAgentTaskInput = z.infer<typeof retryAgentTaskInputSchema>;
export type CancelAgentRunInput = z.infer<typeof cancelAgentRunInputSchema>;
export type AgentTaskCursorPayload = z.infer<typeof agentTaskCursorPayloadSchema>;
export type AgentTaskListQuery = z.infer<typeof agentTaskListQuerySchema>;
export type AgentRunConfiguration = z.infer<typeof agentRunConfigurationSchema>;
export type AgentFinalResult = z.infer<typeof agentFinalResultSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type AgentObservation = z.infer<typeof agentObservationSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type AgentEvidence = z.infer<typeof agentEvidenceSchema>;
export type AgentDefinitionResponse = z.infer<typeof agentDefinitionResponseSchema>;
export type AgentDefinitionListResponse = z.infer<typeof agentDefinitionListResponseSchema>;
export type AgentTaskCreateResponse = z.infer<typeof agentTaskCreateResponseSchema>;
export type AgentTaskListResponse = z.infer<typeof agentTaskListResponseSchema>;
export type AgentTaskResponse = z.infer<typeof agentTaskResponseSchema>;
export type AgentRunCreateResponse = z.infer<typeof agentRunCreateResponseSchema>;
export type AgentRunResponse = z.infer<typeof agentRunResponseSchema>;
export type AgentRunTraceResponse = z.infer<typeof agentRunTraceResponseSchema>;
