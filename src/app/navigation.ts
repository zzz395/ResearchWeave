export interface PrimaryNavigationDestination {
  icon: "research" | "spaces" | "connections";
  label: string;
  to: "/research" | "/spaces" | "/connections";
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
      { icon: "connections", label: "Connections", to: "/connections" },
    ],
  },
];
