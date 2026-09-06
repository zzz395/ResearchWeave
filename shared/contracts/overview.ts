import { z } from "zod";

import { activityEventSchema, activityKindSchema } from "./activity";

const spaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
}).strict();

export const overviewRecentSpaceSchema = z.object({
  space: spaceSummarySchema,
  lastActivityAt: z.string().datetime(),
  lastActivityKind: activityKindSchema,
}).strict();

export const overviewActiveWorkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    space: spaceSummarySchema,
    updatedAt: z.string().datetime(),
    document: z.object({
      id: z.string().uuid(),
      originalFilename: z.string().min(1).max(255),
      status: z.enum(["queued", "processing"]),
      stage: z.enum(["extracting", "chunking", "embedding"]).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("agent_run"),
    space: spaceSummarySchema,
    updatedAt: z.string().datetime(),
    run: z.object({
      id: z.string().uuid(),
      taskId: z.string().uuid(),
      agentId: z.string().uuid(),
      agentName: z.string().min(1).max(120),
      attemptNumber: z.number().int().positive(),
      status: z.enum(["queued", "running"]),
    }).strict(),
  }).strict(),
]);

export const overviewResponseSchema = z.object({
  recentSpaces: z.array(overviewRecentSpaceSchema).max(4),
  activeWork: z.array(overviewActiveWorkSchema).max(6),
  recentActivity: z.array(activityEventSchema).max(8),
}).strict();

export type OverviewRecentSpace = z.infer<typeof overviewRecentSpaceSchema>;
export type OverviewActiveWork = z.infer<typeof overviewActiveWorkSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
