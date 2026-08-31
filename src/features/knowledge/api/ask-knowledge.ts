import {
  askKnowledgeRequestSchema,
  groundedAnswerResponseSchema,
  type AskKnowledgeRequest,
  type GroundedAnswerResponse,
} from "../../../../shared/contracts/grounded-answer";
import { apiRequest } from "../../../services/api/client";

export async function askKnowledge(
  spaceId: string,
  request: AskKnowledgeRequest,
): Promise<GroundedAnswerResponse> {
  const body = askKnowledgeRequestSchema.parse(request);
  return apiRequest(
    `/api/v1/spaces/${spaceId}/knowledge/ask`,
    groundedAnswerResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
