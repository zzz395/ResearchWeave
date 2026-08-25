import {
  chatHistoryResponseSchema,
  type ChatHistoryResponse,
} from "../../../../shared/contracts/chat";
import { apiRequest } from "../../../services/api/client";

export async function listMessages(
  spaceId: string,
  cursor?: string,
): Promise<ChatHistoryResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiRequest(`/api/v1/spaces/${spaceId}/messages${query}`, chatHistoryResponseSchema);
}

