import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  overviewActiveWorkSchema,
  overviewRecentSpaceSchema,
} from "../../shared/contracts/overview";
import {
  getOverviewActiveWorkPresentation,
  getOverviewRecentSpacePresentation,
} from "../../src/features/overview/overview-presentation";

const space = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Graph Lab",
};
const updatedAt = "2026-09-06T08:00:00.000Z";

describe("Overview presentation", () => {
  it("links recent Spaces and labels their last Activity kind", () => {
    const item = overviewRecentSpaceSchema.parse({
      space,
      lastActivityAt: updatedAt,
      lastActivityKind: "paper_saved",
    });

    expect(getOverviewRecentSpacePresentation(item)).toEqual({
      activityLabel: "Paper saved",
      href: `/spaces/${space.id}`,
    });
  });

  it("represents active Documents with contract status and optional stage", () => {
    const item = overviewActiveWorkSchema.parse({
      kind: "document",
      space,
      updatedAt,
      document: {
        id: "20000000-0000-4000-8000-000000000002",
        originalFilename: "corpus-notes.pdf",
        status: "processing",
        stage: "embedding",
      },
    });

    expect(getOverviewActiveWorkPresentation(item)).toEqual({
      title: "corpus-notes.pdf",
      typeLabel: "Document",
      statusLabel: "Processing",
      stageLabel: "Embedding",
      href: `/spaces/${space.id}/knowledge`,
    });
  });

  it("represents active Agent Runs without synthetic progress or metrics", () => {
    const item = overviewActiveWorkSchema.parse({
      kind: "agent_run",
      space,
      updatedAt,
      run: {
        id: "20000000-0000-4000-8000-000000000002",
        taskId: "30000000-0000-4000-8000-000000000003",
        agentId: "40000000-0000-4000-8000-000000000004",
        agentName: "Research Agent",
        attemptNumber: 3,
        status: "running",
      },
    });
    const presentation = getOverviewActiveWorkPresentation(item);

    expect(presentation).toEqual({
      title: "Research Agent · run #3",
      typeLabel: "Agent Run",
      statusLabel: "Running",
      href: "/agents/runs/20000000-0000-4000-8000-000000000002",
    });
    expect(Object.keys(presentation)).not.toEqual(expect.arrayContaining([
      "percent", "progress", "estimate", "successRate", "trend",
    ]));
  });

  it("reuses the shared Activity event list for recent Activity", () => {
    const source = readFileSync(
      new URL("../../src/features/overview/pages/overview-page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<ActivityEventList events={overview.recentActivity} />");
  });
});
