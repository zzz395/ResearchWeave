import { describe, expect, test } from "vitest";

import {
  buildAgentRunPersistenceViews,
  calculateAgentLeaseExpiry,
  classifyAgentIdempotency,
  classifyAgentWorkerWrite,
  isAgentLeaseExpired,
} from "../../server/modules/agents/repository";
import type { AgentRunRecord } from "../../server/db/schema";

const NOW = new Date("2026-09-03T00:01:00.000Z");

function runRecord(
  id: string,
  status: AgentRunRecord["status"],
  finalStatus: AgentRunRecord["finalStatus"] = null,
): AgentRunRecord {
  const started = status === "queued" || status === "cancelled" ? null : NOW;
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  return {
    id,
    taskId: "40000000-0000-4000-8000-000000000001",
    spaceId: "20000000-0000-4000-8000-000000000001",
    actorUserId: "10000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    status,
    definitionRevision: 1,
    toolNames: ["search_arxiv"],
    maxSteps: 8,
    maxToolCalls: 6,
    wallTimeSeconds: 180,
    providerDecisionTimeoutSeconds: 30,
    toolTimeoutSeconds: 45,
    providerAttempts: 2,
    providerResponseMaxBytes: 65_536,
    observationMaxBytes: 32_768,
    contextMaxBytes: 131_072,
    finalAnswerMaxCharacters: 8_000,
    maxEvidence: 32,
    promptVersion: "research-agent-v1",
    providerModel: "test-model",
    stepCount: status === "completed" ? 2 : 0,
    toolCallCount: status === "completed" ? 1 : 0,
    contextBytes: 0,
    leaseOwnerId: status === "running" ? "90000000-0000-4000-8000-000000000001" : null,
    leaseGeneration: status === "running" ? 1 : 0,
    leaseExpiresAt: status === "running" ? new Date(NOW.getTime() + 60_000) : null,
    cancelRequestedAt: status === "cancelled" ? NOW : null,
    cancelRequestedByUserId: status === "cancelled" ? "10000000-0000-4000-8000-000000000001" : null,
    startedAt: started,
    deadlineAt: started ? new Date(started.getTime() + 180_000) : null,
    finishedAt: terminal ? NOW : null,
    errorCode: status === "failed" ? "agent_provider_unavailable" : null,
    finalStatus,
    finalAnswer: status === "completed" ? "Grounded result [E1] [E2]" : null,
    retryClientRequestId: null,
    retryRequestFingerprint: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Agent repository policy helpers", () => {
  test("builds Service-facing Run views with ordered final Evidence references", () => {
    const completed = runRecord(
      "50000000-0000-4000-8000-000000000001",
      "completed",
      "answered",
    );
    const queued = runRecord("50000000-0000-4000-8000-000000000002", "queued");

    expect(
      buildAgentRunPersistenceViews([completed, queued], [
        { runId: completed.id, evidenceKey: "E2", finalOrdinal: 2 },
        { runId: completed.id, evidenceKey: "E1", finalOrdinal: 1 },
      ]),
    ).toEqual([
      { record: completed, finalEvidenceIds: ["E1", "E2"] },
      { record: queued, finalEvidenceIds: [] },
    ]);
  });

  test("rejects invalid persisted final Evidence reference shapes", () => {
    const completed = runRecord(
      "50000000-0000-4000-8000-000000000001",
      "completed",
      "answered",
    );
    const running = runRecord("50000000-0000-4000-8000-000000000002", "running");

    expect(() =>
      buildAgentRunPersistenceViews([running], [
        { runId: running.id, evidenceKey: "E1", finalOrdinal: 1 },
      ]),
    ).toThrow("non-completed");
    expect(() =>
      buildAgentRunPersistenceViews([completed], [
        { runId: completed.id, evidenceKey: "E2", finalOrdinal: 2 },
      ]),
    ).toThrow("contiguous");
    expect(() =>
      buildAgentRunPersistenceViews([completed], [
        {
          runId: "50000000-0000-4000-8000-000000000099",
          evidenceKey: "E1",
          finalOrdinal: 1,
        },
      ]),
    ).toThrow("unknown Run");
  });

  test("caps a renewed lease at the immutable run deadline", () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const deadline = new Date("2026-09-03T00:00:30.000Z");

    expect(calculateAgentLeaseExpiry(now, 10_000, deadline)).toEqual(
      new Date("2026-09-03T00:00:10.000Z"),
    );
    expect(calculateAgentLeaseExpiry(now, 60_000, deadline)).toEqual(deadline);
    expect(() => calculateAgentLeaseExpiry(now, 0, deadline)).toThrow(TypeError);
  });

  test("treats the exact expiry boundary and later times as stale", () => {
    const expiresAt = new Date("2026-09-03T00:00:30.000Z");

    expect(
      isAgentLeaseExpired(
        { leaseExpiresAt: expiresAt },
        new Date("2026-09-03T00:00:29.999Z"),
      ),
    ).toBe(false);
    expect(isAgentLeaseExpired({ leaseExpiresAt: expiresAt }, expiresAt)).toBe(true);
    expect(
      isAgentLeaseExpired(
        { leaseExpiresAt: expiresAt },
        new Date("2026-09-03T00:00:30.001Z"),
      ),
    ).toBe(true);
    expect(isAgentLeaseExpired({ leaseExpiresAt: null }, NOW)).toBe(true);
  });

  test("gives cancellation priority over authorization and deadline failures", () => {
    const now = new Date("2026-09-03T00:01:00.000Z");
    const expired = new Date("2026-09-03T00:00:59.000Z");

    expect(
      classifyAgentWorkerWrite(
        { cancelRequestedAt: now, deadlineAt: expired },
        false,
        now,
      ),
    ).toBe("cancel_requested");
    expect(
      classifyAgentWorkerWrite(
        { cancelRequestedAt: null, deadlineAt: expired },
        false,
        now,
      ),
    ).toBe("access_revoked");
    expect(
      classifyAgentWorkerWrite(
        { cancelRequestedAt: null, deadlineAt: expired },
        true,
        now,
      ),
    ).toBe("deadline_exceeded");
    expect(
      classifyAgentWorkerWrite(
        {
          cancelRequestedAt: null,
          deadlineAt: new Date("2026-09-03T00:01:01.000Z"),
        },
        true,
        now,
      ),
    ).toBe("allowed");
  });

  test("maps request fingerprints to stable idempotency outcomes", () => {
    expect(classifyAgentIdempotency("a".repeat(64), "a".repeat(64))).toBe("existing");
    expect(classifyAgentIdempotency("a".repeat(64), "b".repeat(64))).toBe(
      "idempotency_conflict",
    );
  });
});
