import {
  overviewResponseSchema,
  type OverviewResponse,
} from "../../../../shared/contracts/overview";
import { apiRequest } from "../../../services/api/client";

export function getOverview(): Promise<OverviewResponse> {
  return apiRequest("/api/v1/overview", overviewResponseSchema);
}
