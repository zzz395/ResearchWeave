import { infiniteQueryOptions } from "@tanstack/react-query";

import { listDocuments } from "./documents";
import { documentQueryKeys } from "./query-keys";

export const DOCUMENT_PAGE_SIZE = 50;

export function documentListQueryOptions(spaceId: string) {
  return infiniteQueryOptions({
    queryKey: documentQueryKeys.list(spaceId),
    queryFn: ({ pageParam }) => listDocuments(spaceId, {
      cursor: pageParam,
      limit: DOCUMENT_PAGE_SIZE,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
