import { z } from "zod";

const documentIdSchema = z.string().uuid();

export function getAskKnowledgeInstanceKey(spaceId: string): string {
  return spaceId;
}

export function getKnowledgeDocumentId(searchParams: URLSearchParams): string | null {
  const result = documentIdSchema.safeParse(searchParams.get("document"));
  return result.success ? result.data : null;
}

export function createKnowledgeDocumentSearchParams(
  current: URLSearchParams,
  documentId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (documentId === null) {
    next.delete("document");
  } else {
    next.set("document", documentIdSchema.parse(documentId));
  }
  return next;
}
