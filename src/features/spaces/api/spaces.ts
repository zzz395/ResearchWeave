import { z } from "zod";

import {
  researchSpaceListResponseSchema,
  researchSpaceResponseSchema,
  type CreateSpaceInput,
  type ResearchSpace,
  type UpdateSpaceInput,
} from "../../../../shared/contracts/spaces";
import { apiRequest } from "../../../services/api/client";

export async function listSpaces(): Promise<ResearchSpace[]> {
  return (await apiRequest("/api/v1/spaces", researchSpaceListResponseSchema)).spaces;
}

export async function getSpace(spaceId: string): Promise<ResearchSpace> {
  return (await apiRequest(`/api/v1/spaces/${spaceId}`, researchSpaceResponseSchema)).space;
}

export async function createSpace(input: CreateSpaceInput): Promise<ResearchSpace> {
  return (
    await apiRequest("/api/v1/spaces", researchSpaceResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [201],
    })
  ).space;
}

export async function updateSpace(
  spaceId: string,
  input: UpdateSpaceInput,
): Promise<ResearchSpace> {
  return (
    await apiRequest(`/api/v1/spaces/${spaceId}`, researchSpaceResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  ).space;
}

export async function deleteSpace(spaceId: string): Promise<void> {
  await apiRequest(`/api/v1/spaces/${spaceId}`, z.undefined(), {
    method: "DELETE",
    acceptedStatuses: [204],
  });
}
