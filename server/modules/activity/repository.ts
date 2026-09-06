import { and, eq, sql, type SQL } from "drizzle-orm";

import type {
  ActivityCategory,
  ActivityEvent,
  ActivityKind,
} from "../../../shared/contracts/activity";
import {
  ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
  ACTIVITY_PAPER_TITLE_MAX_CHARACTERS,
  truncateActivitySummary,
} from "../../../shared/contracts/activity";
import type {
  OverviewActiveWork,
  OverviewRecentSpace,
} from "../../../shared/contracts/overview";
import type { Database } from "../../db/client";
import { spaceMembers } from "../../db/schema";

export interface ActivityCursorRecord {
  occurredAt: Date;
  stableEventKey: string;
}

export interface ActivityProjectionRecord extends Omit<ActivityEvent, "occurredAt"> {
  occurredAt: Date;
}

export interface ActivityRepositoryQuery {
  spaceId?: string;
  category?: ActivityCategory;
  cursor: ActivityCursorRecord | null;
  limit: number;
}

export type ActivityListRepositoryResult =
  | { status: "ok"; records: ActivityProjectionRecord[] }
  | { status: "space_not_found" };

type OverviewActiveWorkProjection =
  | (Omit<Extract<OverviewActiveWork, { kind: "document" }>, "updatedAt"> & {
      updatedAt: Date;
    })
  | (Omit<Extract<OverviewActiveWork, { kind: "agent_run" }>, "updatedAt"> & {
      updatedAt: Date;
    });

export interface OverviewProjection {
  recentSpaces: Array<Omit<OverviewRecentSpace, "lastActivityAt"> & { lastActivityAt: Date }>;
  activeWork: OverviewActiveWorkProjection[];
  recentActivity: ActivityProjectionRecord[];
}

export interface ActivityRepository {
  listForActor(actorId: string, query: ActivityRepositoryQuery): Promise<ActivityListRepositoryResult>;
  getOverviewForActor(actorId: string): Promise<OverviewProjection>;
}

interface ActivitySqlRow {
  stable_event_key: string;
  kind: ActivityKind;
  category: ActivityCategory;
  occurred_at: Date;
  actor_id: string | null;
  actor_display_name: string | null;
  space_id: string | null;
  space_name: string | null;
  subject: ActivityEvent["subject"];
  target: ActivityEvent["target"];
}

interface RecentSpaceSqlRow {
  space_id: string;
  space_name: string;
  last_activity_at: Date;
  last_activity_kind: ActivityKind;
}

interface ActiveWorkSqlRow {
  kind: "document" | "agent_run";
  updated_at: Date;
  space_id: string;
  space_name: string;
  item: Record<string, unknown>;
}

type OverviewDocumentWork = Extract<OverviewActiveWork, { kind: "document" }>["document"];
type OverviewAgentRunWork = Extract<OverviewActiveWork, { kind: "agent_run" }>["run"];

function activityEventsSql(actorId: string): SQL {
  return sql`
    with accessible_spaces as (
      select sm.space_id
      from space_members sm
      where sm.user_id = ${actorId}::uuid
    ), activity_events as (
      select
        'connection_requested:' || c.id::text as stable_event_key,
        'connection_requested'::text as kind,
        'collaboration'::text as category,
        c.created_at as occurred_at,
        requester.id as actor_id,
        requester.display_name as actor_display_name,
        null::uuid as space_id,
        null::text as space_name,
        jsonb_build_object(
          'type', 'connection',
          'connectionId', c.id,
          'status', c.status,
          'otherUser', jsonb_build_object('id', other_user.id, 'displayName', other_user.display_name)
        ) as subject,
        jsonb_build_object('type', 'connection', 'connectionId', c.id) as target
      from connections c
      join users requester on requester.id = c.requested_by_user_id
      join users other_user on other_user.id = case
        when c.user_low_id = ${actorId}::uuid then c.user_high_id else c.user_low_id end
      where c.user_low_id = ${actorId}::uuid or c.user_high_id = ${actorId}::uuid

      union all

      select
        'connection_accepted:' || c.id::text,
        'connection_accepted'::text,
        'collaboration'::text,
        c.responded_at,
        responder.id,
        responder.display_name,
        null::uuid,
        null::text,
        jsonb_build_object(
          'type', 'connection',
          'connectionId', c.id,
          'status', c.status,
          'otherUser', jsonb_build_object('id', other_user.id, 'displayName', other_user.display_name)
        ),
        jsonb_build_object('type', 'connection', 'connectionId', c.id)
      from connections c
      join users responder on responder.id = case
        when c.requested_by_user_id = c.user_low_id then c.user_high_id else c.user_low_id end
      join users other_user on other_user.id = case
        when c.user_low_id = ${actorId}::uuid then c.user_high_id else c.user_low_id end
      where c.status = 'accepted'
        and c.responded_at is not null
        and (c.user_low_id = ${actorId}::uuid or c.user_high_id = ${actorId}::uuid)

      union all

      select
        'space_created:' || s.id::text,
        'space_created'::text,
        'collaboration'::text,
        s.created_at,
        owner_user.id,
        owner_user.display_name,
        s.id,
        s.name,
        jsonb_build_object('type', 'space', 'spaceId', s.id, 'name', s.name),
        jsonb_build_object('type', 'space', 'spaceId', s.id)
      from research_spaces s
      join accessible_spaces access on access.space_id = s.id
      join users owner_user on owner_user.id = s.owner_id

      union all

      select
        'member_joined:' || sm.space_id::text || ':' || sm.user_id::text,
        'member_joined'::text,
        'collaboration'::text,
        sm.joined_at,
        member_user.id,
        member_user.display_name,
        s.id,
        s.name,
        jsonb_build_object('type', 'member', 'userId', member_user.id, 'displayName', member_user.display_name),
        jsonb_build_object('type', 'space_member', 'spaceId', s.id, 'userId', member_user.id)
      from space_members sm
      join accessible_spaces access on access.space_id = sm.space_id
      join research_spaces s on s.id = sm.space_id
      join users member_user on member_user.id = sm.user_id

      union all

      select
        'chat_message_created:' || m.id::text,
        'chat_message_created'::text,
        'collaboration'::text,
        m.created_at,
        sender.id,
        sender.display_name,
        s.id,
        s.name,
        jsonb_build_object('type', 'chat_message', 'messageId', m.id),
        jsonb_build_object('type', 'chat_message', 'spaceId', s.id, 'messageId', m.id)
      from chat_messages m
      join accessible_spaces access on access.space_id = m.space_id
      join research_spaces s on s.id = m.space_id
      join users sender on sender.id = m.sender_user_id

      union all

      select
        'paper_saved:' || sp.space_id::text || ':' || sp.paper_id::text,
        'paper_saved'::text,
        'research'::text,
        sp.saved_at,
        saver.id,
        saver.display_name,
        s.id,
        s.name,
        jsonb_build_object(
          'type', 'paper',
          'paperId', p.id,
          'title', left(p.title, ${ACTIVITY_PAPER_TITLE_MAX_CHARACTERS}),
          'canonicalArxivId', left(p.canonical_arxiv_id, ${ACTIVITY_ARXIV_ID_MAX_CHARACTERS}),
          'versionedArxivId', left(p.versioned_arxiv_id, ${ACTIVITY_ARXIV_ID_MAX_CHARACTERS})
        ),
        jsonb_build_object('type', 'saved_paper', 'spaceId', s.id, 'paperId', p.id)
      from saved_papers sp
      join accessible_spaces access on access.space_id = sp.space_id
      join research_spaces s on s.id = sp.space_id
      join papers p on p.id = sp.paper_id
      left join users saver on saver.id = sp.saved_by_user_id

      union all

      select
        'document_uploaded:' || d.id::text,
        'document_uploaded'::text,
        'knowledge'::text,
        d.created_at,
        uploader.id,
        uploader.display_name,
        s.id,
        s.name,
        jsonb_build_object(
          'type', 'document',
          'documentId', d.id,
          'originalFilename', d.original_filename,
          'status', d.status
        ),
        jsonb_build_object('type', 'document', 'spaceId', s.id, 'documentId', d.id)
      from documents d
      join accessible_spaces access on access.space_id = d.space_id
      join research_spaces s on s.id = d.space_id
      left join users uploader on uploader.id = d.uploaded_by_user_id

      union all

      select
        'agent_task_created:' || t.id::text,
        'agent_task_created'::text,
        'agents'::text,
        t.created_at,
        creator.id,
        creator.display_name,
        s.id,
        s.name,
        jsonb_build_object(
          'type', 'agent_task',
          'taskId', t.id,
          'agentId', definition.id,
          'agentName', definition.name
        ),
        jsonb_build_object('type', 'agent_task', 'spaceId', s.id, 'taskId', t.id)
      from agent_tasks t
      join accessible_spaces access on access.space_id = t.space_id
      join research_spaces s on s.id = t.space_id
      join agent_definitions definition on definition.id = t.agent_id
      left join users creator on creator.id = t.created_by_user_id

      union all

      select
        'agent_run_created:' || r.id::text,
        'agent_run_created'::text,
        'agents'::text,
        r.created_at,
        run_actor.id,
        run_actor.display_name,
        s.id,
        s.name,
        jsonb_build_object(
          'type', 'agent_run',
          'runId', r.id,
          'taskId', r.task_id,
          'agentId', definition.id,
          'agentName', definition.name,
          'attemptNumber', r.attempt_number,
          'status', r.status
        ),
        jsonb_build_object(
          'type', 'agent_run', 'spaceId', s.id, 'taskId', r.task_id, 'runId', r.id
        )
      from agent_runs r
      join accessible_spaces access on access.space_id = r.space_id
      join research_spaces s on s.id = r.space_id
      join agent_tasks t on t.id = r.task_id and t.space_id = r.space_id
      join agent_definitions definition on definition.id = t.agent_id
      left join users run_actor on run_actor.id = r.actor_user_id
    )
  `;
}

function toActivityRecord(row: ActivitySqlRow): ActivityProjectionRecord {
  const subject = row.subject.type === "paper"
    ? {
        ...row.subject,
        title: truncateActivitySummary(
          row.subject.title,
          ACTIVITY_PAPER_TITLE_MAX_CHARACTERS,
        ),
        canonicalArxivId: truncateActivitySummary(
          row.subject.canonicalArxivId,
          ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
        ),
        versionedArxivId: truncateActivitySummary(
          row.subject.versionedArxivId,
          ACTIVITY_ARXIV_ID_MAX_CHARACTERS,
        ),
      }
    : row.subject;
  return {
    id: row.stable_event_key,
    kind: row.kind,
    category: row.category,
    occurredAt: new Date(row.occurred_at),
    actor: row.actor_id && row.actor_display_name
      ? { id: row.actor_id, displayName: row.actor_display_name }
      : null,
    space: row.space_id && row.space_name
      ? { id: row.space_id, name: row.space_name }
      : null,
    subject,
    target: row.target,
  };
}

export function createDrizzleActivityRepository(database: Database): ActivityRepository {
  const db = database.db;

  async function queryActivity(
    actorId: string,
    query: ActivityRepositoryQuery,
  ): Promise<ActivityProjectionRecord[]> {
    const spaceFilter = query.spaceId
      ? sql`and space_id = ${query.spaceId}::uuid`
      : sql``;
    const categoryFilter = query.category
      ? sql`and category = ${query.category}`
      : sql``;
    const cursorFilter = query.cursor
      ? sql`and (
          occurred_at < ${query.cursor.occurredAt.toISOString()}::timestamptz
          or (occurred_at = ${query.cursor.occurredAt.toISOString()}::timestamptz
              and stable_event_key < ${query.cursor.stableEventKey})
        )`
      : sql``;
    const result = await db.execute(sql`
      ${activityEventsSql(actorId)}
      select stable_event_key, kind, category, occurred_at, actor_id, actor_display_name,
             space_id, space_name, subject, target
      from activity_events
      where true ${spaceFilter} ${categoryFilter} ${cursorFilter}
      order by occurred_at desc, stable_event_key desc
      limit ${query.limit}
    `);
    return (result as unknown as ActivitySqlRow[]).map(toActivityRecord);
  }

  return {
    async listForActor(actorId, query) {
      if (query.spaceId) {
        const [membership] = await db
          .select({ userId: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, query.spaceId), eq(spaceMembers.userId, actorId)))
          .limit(1);
        if (!membership) return { status: "space_not_found" };
      }
      return { status: "ok", records: await queryActivity(actorId, query) };
    },

    async getOverviewForActor(actorId) {
      const [recentActivity, recentSpaceResult, activeWorkResult] = await Promise.all([
        queryActivity(actorId, { cursor: null, limit: 8 }),
        db.execute(sql`
          ${activityEventsSql(actorId)}
          select space_id, space_name, occurred_at as last_activity_at,
                 kind as last_activity_kind
          from (
            select distinct on (space_id) space_id, space_name, occurred_at, kind,
                   stable_event_key
            from activity_events
            where space_id is not null
            order by space_id, occurred_at desc, stable_event_key desc
          ) latest
          order by occurred_at desc, stable_event_key desc
          limit 4
        `),
        db.execute(sql`
          with accessible_spaces as (
            select sm.space_id from space_members sm where sm.user_id = ${actorId}::uuid
          ), active_work as (
            select
              'document'::text as kind,
              d.updated_at,
              s.id as space_id,
              s.name as space_name,
              'document:' || d.id::text as stable_key,
              jsonb_build_object(
                'id', d.id,
                'originalFilename', d.original_filename,
                'status', d.status,
                'stage', d.stage
              ) as item
            from documents d
            join accessible_spaces access on access.space_id = d.space_id
            join research_spaces s on s.id = d.space_id
            where d.status in ('queued', 'processing')

            union all

            select
              'agent_run'::text,
              r.updated_at,
              s.id,
              s.name,
              'agent_run:' || r.id::text,
              jsonb_build_object(
                'id', r.id,
                'taskId', r.task_id,
                'agentId', definition.id,
                'agentName', definition.name,
                'attemptNumber', r.attempt_number,
                'status', r.status
              )
            from agent_runs r
            join accessible_spaces access on access.space_id = r.space_id
            join research_spaces s on s.id = r.space_id
            join agent_tasks t on t.id = r.task_id and t.space_id = r.space_id
            join agent_definitions definition on definition.id = t.agent_id
            where r.status in ('queued', 'running')
          )
          select kind, updated_at, space_id, space_name, item
          from active_work
          order by updated_at desc, stable_key desc
          limit 6
        `),
      ]);

      const recentSpaces = (recentSpaceResult as unknown as RecentSpaceSqlRow[]).map((row) => ({
        space: { id: row.space_id, name: row.space_name },
        lastActivityAt: new Date(row.last_activity_at),
        lastActivityKind: row.last_activity_kind,
      }));
      const activeWork = (activeWorkResult as unknown as ActiveWorkSqlRow[]).map((row) =>
        row.kind === "document"
          ? {
              kind: "document" as const,
              space: { id: row.space_id, name: row.space_name },
              updatedAt: new Date(row.updated_at),
              document: row.item as OverviewDocumentWork,
            }
          : {
              kind: "agent_run" as const,
              space: { id: row.space_id, name: row.space_name },
              updatedAt: new Date(row.updated_at),
              run: row.item as OverviewAgentRunWork,
            },
      );
      return { recentSpaces, activeWork, recentActivity };
    },
  };
}
