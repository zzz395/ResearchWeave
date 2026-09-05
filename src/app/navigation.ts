export interface PrimaryNavigationDestination {
  icon: "research" | "spaces" | "agents" | "connections";
  label: string;
  to: "/research" | "/spaces" | "/agents" | "/connections";
}

export interface PrimaryNavigationGroup {
  label: string;
  destinations: readonly PrimaryNavigationDestination[];
}

export const primaryNavigationGroups: readonly PrimaryNavigationGroup[] = [
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
];
