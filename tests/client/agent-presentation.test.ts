/// <reference lib="dom" />

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  agentEvidenceSchema,
  type AgentRun,
} from "../../shared/contracts/agents";
import {
  createAgentTaskSearchParams,
  getAgentApiErrorMessage,
  getAgentAvailabilityPresentation,
  getAgentEvidenceLink,
  getAgentExecutionErrorMessage,
  getAgentRunStatusPresentation,
  isAgentAccessRevocation,
  parseAgentTaskSearchParams,
  resolveClientRequestIdentity,
  shouldPollAgentDefinitions,
  shouldPollAgentRuns,
} from "../../src/features/agents/agent-presentation";
import {
  AgentAvailabilityBadge,
  AgentStatusBadge,
} from "../../src/features/agents/components/agent-status-badge";
import { ApiClientError } from "../../src/services/api/client";

const spaceId = "10000000-0000-4000-8000-000000000001";
const agentId = "20000000-0000-4000-8000-000000000002";
const run = {
  status: "running",
  cancelRequestedAt: null,
} as AgentRun;

describe("Agent presentation state", () => {
  it("maps known command errors and preserves generic API fallbacks", () => {
    expect(getAgentApiErrorMessage(
      new ApiClientError("server detail", "agent_runtime_unavailable"),
    )).toBe("The Agent runtime is not ready. Try again when it becomes available.");
    expect(getAgentApiErrorMessage(
      new ApiClientError("The API could not be reached.", "network_error"),
    )).toBe("The API could not be reached.");
  });

  it("distinguishes active cancellation from terminal cancellation", () => {
    expect(getAgentRunStatusPresentation(run)).toEqual({ label: "Running", tone: "active" });
    expect(getAgentRunStatusPresentation({
      ...run,
      cancelRequestedAt: "2026-09-05T00:00:00.000Z",
    })).toEqual({ label: "Cancel requested", tone: "active" });
    expect(getAgentRunStatusPresentation({
      ...run,
      status: "cancelled",
      finishedAt: "2026-09-05T00:01:00.000Z",
    } as AgentRun)).toEqual({ label: "Cancelled", tone: "neutral" });
  });

  it("polls only transient runtime and Run states", () => {
    expect(shouldPollAgentDefinitions([
      { availability: { available: false, reason: "runtime_unavailable" } },
    ])).toBe(true);
    expect(shouldPollAgentDefinitions([
      { availability: { available: false, reason: "provider_unconfigured" } },
    ])).toBe(false);
    expect(shouldPollAgentRuns([{ status: "queued" }, { status: "completed" }])).toBe(true);
    expect(shouldPollAgentRuns([{ status: "failed" }, { status: "cancelled" }])).toBe(false);
  });

  it("explains every readiness category without claiming false readiness", () => {
    expect(getAgentAvailabilityPresentation({ available: true, reason: null }).label).toBe("Ready");
    expect(getAgentAvailabilityPresentation({
      available: false,
      reason: "provider_unconfigured",
    }).label).toBe("Provider not configured");
    expect(getAgentAvailabilityPresentation({
      available: false,
      reason: "runtime_unavailable",
    }).label).toBe("Runtime unavailable");
    expect(getAgentAvailabilityPresentation({
      available: false,
      reason: "agent_disabled",
    }).label).toBe("Disabled");
  });

  it("round-trips canonical task filters and drops invalid values", () => {
    const canonical = createAgentTaskSearchParams({
      spaceId,
      agentId,
      status: "running",
    });
    expect(canonical.toString()).toBe(
      "space=" + spaceId + "&agent=" + agentId + "&status=running",
    );
    expect(parseAgentTaskSearchParams(canonical)).toEqual({
      spaceId,
      agentId,
      status: "running",
    });
    expect(parseAgentTaskSearchParams(
      new URLSearchParams("space=nope&agent=nope&status=unknown"),
    )).toEqual({});
  });

  it("retains a request id for one logical request and rotates it when input changes", () => {
    let generated = 0;
    const createId = () => "request-" + String(++generated);
    const first = resolveClientRequestIdentity(null, "space-agent-prompt", createId);
    const replay = resolveClientRequestIdentity(first, "space-agent-prompt", createId);
    const changed = resolveClientRequestIdentity(first, "space-agent-other-prompt", createId);

    expect(replay).toBe(first);
    expect(changed).toEqual({
      fingerprint: "space-agent-other-prompt",
      id: "request-2",
    });
  });

  it("maps validated arXiv evidence to internal and external source links", () => {
    const paperEvidence = agentEvidenceSchema.parse({
      id: "30000000-0000-4000-8000-000000000003",
      runId: "30000000-0000-4000-8000-000000000004",
      stepId: "30000000-0000-4000-8000-000000000005",
      evidenceId: "E1",
      kind: "arxiv_abstract",
      available: true,
      finalOrdinal: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      paperId: "30000000-0000-4000-8000-000000000006",
      canonicalArxivId: "2609.00001",
      versionedArxivId: "2609.00001v1",
      sourceVersion: 1,
      title: "Durable evidence",
      url: "https://arxiv.org/abs/2609.00001v1",
      excerpt: "A server-validated arXiv abstract excerpt.",
    });
    const externalEvidence = agentEvidenceSchema.parse({
      ...paperEvidence,
      available: false,
      paperId: null,
    });

    expect(getAgentEvidenceLink(paperEvidence, spaceId)).toEqual({
      external: false,
      href: "/research/papers/30000000-0000-4000-8000-000000000006",
    });
    expect(getAgentEvidenceLink(externalEvidence, spaceId)).toEqual({
      external: true,
      href: "https://arxiv.org/abs/2609.00001v1",
    });
    expect(paperEvidence.finalOrdinal).toBe(1);
    expect(externalEvidence.finalOrdinal).toBe(1);
  });

  it("keeps unavailable Knowledge evidence snapshot-only", () => {
    const knowledgeEvidence = agentEvidenceSchema.parse({
      id: "40000000-0000-4000-8000-000000000003",
      runId: "40000000-0000-4000-8000-000000000004",
      stepId: "40000000-0000-4000-8000-000000000005",
      evidenceId: "E2",
      kind: "knowledge_chunk",
      available: false,
      finalOrdinal: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      documentId: null,
      originalFilename: "retained.pdf",
      contentHash: "a".repeat(64),
      ordinal: 0,
      pageNumber: 1,
      startOffset: 0,
      endOffset: 24,
      excerpt: "A retained Knowledge excerpt.",
    });

    expect(getAgentEvidenceLink(knowledgeEvidence, spaceId)).toBeNull();
  });

  it("opts current statuses into polite announcements without making historical badges live", () => {
    const historical = renderToStaticMarkup(createElement(AgentStatusBadge, { run }));
    const current = renderToStaticMarkup(createElement(AgentStatusBadge, {
      announce: true,
      announcementLabel: "Latest run status",
      run: { ...run, cancelRequestedAt: "2026-09-05T00:00:00.000Z" },
    }));
    const readiness = renderToStaticMarkup(createElement(AgentAvailabilityBadge, {
      announce: true,
      announcementLabel: "Research Agent readiness",
      availability: { available: true, reason: null },
    }));

    expect(historical).not.toContain('role="status"');
    expect(historical).not.toContain("aria-live");
    expect(current).toContain('role="status"');
    expect(current).toContain('aria-live="polite"');
    expect(current).toContain('aria-atomic="true"');
    expect(current).toContain("Latest run status: ");
    expect(current).toContain("Cancel requested");
    expect(readiness).toContain('role="status"');
    expect(readiness).toContain("Research Agent readiness: ");
    expect(readiness).toContain("Ready");
  });

  it("enables live status only at polling-owned current status call sites", () => {
    const agentsPage = readFileSync(
      new URL("../../src/features/agents/pages/agents-page.tsx", import.meta.url),
      "utf8",
    );
    const taskListPage = readFileSync(
      new URL("../../src/features/agents/pages/agent-tasks-page.tsx", import.meta.url),
      "utf8",
    );
    const taskPage = readFileSync(
      new URL("../../src/features/agents/pages/agent-task-page.tsx", import.meta.url),
      "utf8",
    );
    const runPage = readFileSync(
      new URL("../../src/features/agents/pages/agent-run-page.tsx", import.meta.url),
      "utf8",
    );

    expect(agentsPage).toMatch(/<AgentAvailabilityBadge\s+announce\s+/u);
    expect(taskListPage).toMatch(/<AgentStatusBadge\s+announce\s+/u);
    expect(taskPage).toMatch(/<AgentStatusBadge\s+announce\s+/u);
    expect(taskPage).toMatch(/function RunAttempt[\s\S]*?<AgentStatusBadge run=\{run\} \/>/u);
    expect(runPage).toContain(
      '<section className="rw-agent-run-overview" aria-live="polite">',
    );
    expect(runPage).not.toMatch(/<AgentStatusBadge\s+announce\s+/u);
  });

  it("maps safe failures and only treats a post-success 404 as access recovery", () => {
    expect(getAgentExecutionErrorMessage("agent_space_access_revoked")).toContain("access changed");
    const notFound = new ApiClientError(
      "Not found",
      "agent_run_not_found",
      404,
      "request-1",
    );
    expect(isAgentAccessRevocation(notFound, false)).toBe(false);
    expect(isAgentAccessRevocation(notFound, true)).toBe(true);
    expect(isAgentAccessRevocation(
      new ApiClientError("Unavailable", "agent_runtime_unavailable", 503),
      true,
    )).toBe(false);
  });
});
