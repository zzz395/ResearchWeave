export interface SpaceNavigationDestination {
  end?: true;
  label: string;
  to: string;
}

export function getSpaceNavigationDestinations(
  spaceId: string,
  role: "owner" | "member",
): SpaceNavigationDestination[] {
  const basePath = `/spaces/${spaceId}`;
  const destinations: SpaceNavigationDestination[] = [
    { end: true, label: "Overview", to: basePath },
    { label: "Saved Papers", to: `${basePath}/saved-papers` },
    { label: "Knowledge", to: `${basePath}/knowledge` },
    { label: "Chat", to: `${basePath}/chat` },
    { label: "Members", to: `${basePath}/members` },
  ];
  if (role === "owner") {
    destinations.push({ label: "Settings", to: `${basePath}/settings` });
  }
  return destinations;
}
