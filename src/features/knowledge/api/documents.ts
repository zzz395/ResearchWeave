import { z } from "zod";

import {
  documentListResponseSchema,
  documentResponseSchema,
  documentUploadResponseSchema,
  type Document,
  type DocumentListQuery,
  type DocumentListResponse,
} from "../../../../shared/contracts/documents";
import { apiRequest } from "../../../services/api/client";

export async function listDocuments(
  spaceId: string,
  query: Pick<DocumentListQuery, "cursor" | "limit">,
): Promise<DocumentListResponse> {
  const search = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) search.set("cursor", query.cursor);
  return apiRequest(
    `/api/v1/spaces/${spaceId}/documents?${search.toString()}`,
    documentListResponseSchema,
  );
}

export async function getDocument(spaceId: string, documentId: string): Promise<Document> {
  return (
    await apiRequest(
      `/api/v1/spaces/${spaceId}/documents/${documentId}`,
      documentResponseSchema,
    )
  ).document;
}

export async function uploadDocument(
  spaceId: string,
  file: File,
): Promise<{ document: Document; created: boolean }> {
  const body = new FormData();
  body.set("file", file);
  return apiRequest(`/api/v1/spaces/${spaceId}/documents`, documentUploadResponseSchema, {
    method: "POST",
    body,
    acceptedStatuses: [200, 201],
  });
}

export async function reindexDocument(spaceId: string, documentId: string): Promise<Document> {
  return (
    await apiRequest(
      `/api/v1/spaces/${spaceId}/documents/${documentId}/reindex`,
      documentResponseSchema,
      { method: "POST", body: JSON.stringify({}), acceptedStatuses: [202] },
    )
  ).document;
}

export async function deleteDocument(spaceId: string, documentId: string): Promise<void> {
  await apiRequest(
    `/api/v1/spaces/${spaceId}/documents/${documentId}`,
    z.undefined(),
    { method: "DELETE", acceptedStatuses: [204] },
  );
}
