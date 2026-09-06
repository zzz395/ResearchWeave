import {
  paperComparisonRequestSchema,
  paperComparisonResponseSchema,
  type PaperComparisonRequest,
  type PaperComparisonResponse,
} from "../../../../shared/contracts/paper-comparison";
import { apiRequest } from "../../../services/api/client";

export async function compareSavedPapers(
  spaceId: string,
  request: PaperComparisonRequest,
): Promise<PaperComparisonResponse> {
  const body = paperComparisonRequestSchema.parse(request);
  return apiRequest(
    `/api/v1/spaces/${spaceId}/paper-comparisons`,
    paperComparisonResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(body),
      acceptedStatuses: [200],
    },
  );
}
