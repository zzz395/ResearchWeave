import { z } from "zod";

export const ACTIVITY_CURSOR_MAX_CHARACTERS = 1_024;
export const ACTIVITY_PAPER_TITLE_MAX_CHARACTERS = 1_000;
export const ACTIVITY_ARXIV_ID_MAX_CHARACTERS = 100;

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const singleIdEventKinds = [
  "connection_requested",
  "connection_accepted",
  "space_created",
  "chat_message_created",
  "document_uploaded",
  "agent_task_created",
  "agent_run_created",
].join("|");
const pairIdEventKinds = ["member_joined", "paper_saved"].join("|");
const stableEventKeyPattern = new RegExp(
  `^(?:(?:${singleIdEventKinds}):${uuidPattern}|(?:${pairIdEventKinds}):${uuidPattern}:${uuidPattern})$`,
  "u",
);
const canonicalBase64UrlPattern = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$/u;

export const activityStableEventKeySchema = z.string().max(256).regex(stableEventKeyPattern);
export const activityCursorSchema = z
  .string()
  .min(1)
  .max(ACTIVITY_CURSOR_MAX_CHARACTERS)
  .regex(canonicalBase64UrlPattern);

export function truncateActivitySummary(value: string, maximumCharacters: number): string {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new TypeError("The Activity summary limit must be a positive integer.");
  }
  if (value.length <= maximumCharacters) return value;
  let end = maximumCharacters;
  const finalCodeUnit = value.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) end -= 1;
  return value.slice(0, end);
}

export const activityCategorySchema = z.enum([
  "collaboration",
  "research",
  "knowledge",
  "agents",
]);

export const activityKindSchema = z.enum([
  "connection_requested",
  "connection_accepted",
  "space_created",
  "member_joined",
  "chat_message_created",
  "paper_saved",
  "document_uploaded",
  "agent_task_created",
  "agent_run_created",
]);

const actorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(80),
}).strict();

const spaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
}).strict();

const subjectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connection"),
    connectionId: z.string().uuid(),
    status: z.enum(["pending", "accepted"]),
    otherUser: actorSchema,
  }).strict(),
  z.object({
    type: z.literal("space"),
    spaceId: z.string().uuid(),
    name: z.string().min(1).max(80),
  }).strict(),
  z.object({
    type: z.literal("member"),
    userId: z.string().uuid(),
    displayName: z.string().min(1).max(80),
  }).strict(),
  z.object({ type: z.literal("chat_message"), messageId: z.string().uuid() }).strict(),
  z.object({
    type: z.literal("paper"),
    paperId: z.string().uuid(),
    title: z.string().min(1).max(ACTIVITY_PAPER_TITLE_MAX_CHARACTERS),
    canonicalArxivId: z.string().min(1).max(ACTIVITY_ARXIV_ID_MAX_CHARACTERS),
    versionedArxivId: z.string().min(1).max(ACTIVITY_ARXIV_ID_MAX_CHARACTERS),
  }).strict(),
  z.object({
    type: z.literal("document"),
    documentId: z.string().uuid(),
    originalFilename: z.string().min(1).max(255),
    status: z.enum(["queued", "processing", "ready", "failed"]),
  }).strict(),
  z.object({
    type: z.literal("agent_task"),
    taskId: z.string().uuid(),
    agentId: z.string().uuid(),
    agentName: z.string().min(1).max(120),
  }).strict(),
  z.object({
    type: z.literal("agent_run"),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    agentId: z.string().uuid(),
    agentName: z.string().min(1).max(120),
    attemptNumber: z.number().int().positive(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  }).strict(),
]);

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connection"), connectionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("space"), spaceId: z.string().uuid() }).strict(),
  z.object({
    type: z.literal("space_member"),
    spaceId: z.string().uuid(),
    userId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("chat_message"),
    spaceId: z.string().uuid(),
    messageId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("saved_paper"),
    spaceId: z.string().uuid(),
    paperId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("document"),
    spaceId: z.string().uuid(),
    documentId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("agent_task"),
    spaceId: z.string().uuid(),
    taskId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("agent_run"),
    spaceId: z.string().uuid(),
    taskId: z.string().uuid(),
    runId: z.string().uuid(),
  }).strict(),
]);

export const activityEventSchema = z.object({
  id: activityStableEventKeySchema,
  kind: activityKindSchema,
  category: activityCategorySchema,
  occurredAt: z.string().datetime(),
  actor: actorSchema.nullable(),
  space: spaceSummarySchema.nullable(),
  subject: subjectSchema,
  target: targetSchema,
}).strict();

export const activityListQuerySchema = z.object({
  cursor: z.string().min(1).max(ACTIVITY_CURSOR_MAX_CHARACTERS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  spaceId: z.string().uuid().optional(),
  category: activityCategorySchema.optional(),
}).strict();

export const activityListResponseSchema = z.object({
  events: z.array(activityEventSchema).max(50),
  nextCursor: activityCursorSchema.nullable(),
}).strict();

export type ActivityCategory = z.infer<typeof activityCategorySchema>;
export type ActivityKind = z.infer<typeof activityKindSchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;
