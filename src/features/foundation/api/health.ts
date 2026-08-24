import {
  healthResponseSchema,
  type HealthResponse,
} from "../../../../shared/contracts/health";
import { apiRequest } from "../../../services/api/client";

export function getHealth(): Promise<HealthResponse> {
  return apiRequest("/api/v1/health", healthResponseSchema, {
    acceptedStatuses: [200, 503],
  });
}
