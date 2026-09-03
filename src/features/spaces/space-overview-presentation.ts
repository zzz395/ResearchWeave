export type OverviewCollectionState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: readonly T[] };

export function resolveOverviewCollection<T>({
  data,
  isError,
  isPending,
}: {
  data: readonly T[] | undefined;
  isError: boolean;
  isPending: boolean;
}): OverviewCollectionState<T> {
  if (isPending) return { status: "loading" };
  if (isError || !data) return { status: "error" };
  return { status: "ready", items: data };
}

export function getOverviewDocumentCountLabel({
  count,
  nextCursor,
}: {
  count: number;
  nextCursor: string | null;
}): string {
  return nextCursor === null
    ? `${count} ${count === 1 ? "document" : "documents"}`
    : `${count} loaded`;
}

export function isOverviewDocumentListEmpty({
  count,
  nextCursor,
}: {
  count: number;
  nextCursor: string | null;
}): boolean {
  return count === 0 && nextCursor === null;
}
