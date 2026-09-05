import { describe, expect, it } from "vitest";

import { primaryNavigationGroups } from "../../src/app/navigation";
import { getSpaceNavigationDestinations } from "../../src/features/spaces/space-navigation";

describe("Primary navigation architecture", () => {
  it("groups the primary destinations under Discover and Workspace", () => {
    expect(primaryNavigationGroups).toEqual([
      {
        label: "Discover",
        destinations: [{ icon: "research", label: "Research", to: "/research" }],
      },
      {
        label: "Workspace",
        destinations: [
          { icon: "spaces", label: "Spaces", to: "/spaces" },
          { icon: "agents", label: "Agents", to: "/agents" },
          { icon: "connections", label: "Connections", to: "/connections" },
        ],
      },
    ]);
  });

  it("keeps the frozen owner Space tab order and routes", () => {
    expect(getSpaceNavigationDestinations("space-1", "owner")).toEqual([
      { end: true, label: "Overview", to: "/spaces/space-1" },
      { label: "Saved Papers", to: "/spaces/space-1/saved-papers" },
      { label: "Knowledge", to: "/spaces/space-1/knowledge" },
      { label: "Chat", to: "/spaces/space-1/chat" },
      { label: "Members", to: "/spaces/space-1/members" },
      { label: "Settings", to: "/spaces/space-1/settings" },
    ]);
  });

  it("hides Settings from non-owner Space navigation", () => {
    expect(getSpaceNavigationDestinations("space-1", "member").map(({ label }) => label))
      .toEqual(["Overview", "Saved Papers", "Knowledge", "Chat", "Members"]);
  });
});
