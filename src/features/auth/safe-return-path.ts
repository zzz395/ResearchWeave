export function safeReturnPath(candidate: string | null): string {
  if (
    !candidate ||
    candidate.length > 512 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.startsWith("/login") ||
    candidate.startsWith("/register")
  ) {
    return "/spaces";
  }
  return candidate;
}
