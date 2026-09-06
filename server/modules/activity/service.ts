import { z } from "zod";

import {
  activityStableEventKeySchema,
  activityEventSchema,
  type ActivityEvent,
  type ActivityListQuery,
  type ActivityListResponse,
} from "../../../shared/contracts/activity";
import { AppError } from "../../middleware/app-error";
import type {
  ActivityCursorRecord,
  ActivityProjectionRecord,
  ActivityRepository,
} from "./repository";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  stableEventKey: activityStableEventKeySchema,
  spaceId: z.string().uuid().nullable(),
  category: z.enum(["collaboration", "research", "knowledge", "agents"]).nullable(),
}).strict();

const canonicalBase64UrlSchema = /^[A-Za-z0-9_-]+$/u;

export interface ActivityService {
  list(actorId: string, query: ActivityListQuery): Promise<ActivityListResponse>;
}

function toEvent(record: ActivityProjectionRecord): ActivityEvent {
  return activityEventSchema.parse({
    ...record,
    occurredAt: record.occurredAt.toISOString(),
  });
}

function encodeCursor(record: ActivityProjectionRecord, query: ActivityListQuery): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    occurredAt: record.occurredAt.toISOString(),
    stableEventKey: record.id,
    spaceId: query.spaceId ?? null,
    category: query.category ?? null,
  }), "utf8").toString("base64url");
}

function invalidCursor(): never {
  throw new AppError(400, "invalid_activity_cursor", "The activity cursor is invalid.");
}

function decodeCursor(cursor: string | undefined, query: ActivityListQuery): ActivityCursorRecord | null {
  if (!cursor) return null;
  try {
    if (!canonicalBase64UrlSchema.test(cursor) || cursor.length % 4 === 1) invalidCursor();
    const decodedBytes = Buffer.from(cursor, "base64url");
    if (decodedBytes.toString("base64url") !== cursor) invalidCursor();
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes);
    const payload = cursorPayloadSchema.parse(JSON.parse(decodedText) as unknown);
    if (payload.spaceId !== (query.spaceId ?? null) || payload.category !== (query.category ?? null)) {
      invalidCursor();
    }
    return { occurredAt: new Date(payload.occurredAt), stableEventKey: payload.stableEventKey };
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    return invalidCursor();
  }
}

export function createActivityService(repository: ActivityRepository): ActivityService {
  return {
    async list(actorId, query) {
      const result = await repository.listForActor(actorId, {
        spaceId: query.spaceId,
        category: query.category,
        cursor: decodeCursor(query.cursor, query),
        limit: query.limit + 1,
      });
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      const hasMore = result.records.length > query.limit;
      const page = result.records.slice(0, query.limit);
      const last = page.at(-1);
      return {
        events: page.map(toEvent),
        nextCursor: hasMore && last ? encodeCursor(last, query) : null,
      };
    },
  };
}

export { toEvent as toActivityEvent };
