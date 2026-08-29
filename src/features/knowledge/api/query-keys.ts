export const documentQueryKeys = {
  list(spaceId: string) {
    return ["spaces", spaceId, "documents"] as const;
  },
  detail(spaceId: string, documentId: string) {
    return ["spaces", spaceId, "documents", documentId] as const;
  },
};
