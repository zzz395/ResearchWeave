import { z } from "zod";

import {
  spaceMemberListResponseSchema,
  spaceMemberResponseSchema,
  type AddSpaceMemberInput,
  type SpaceMember,
} from "../../../../shared/contracts/members";
import { apiRequest } from "../../../services/api/client";

export async function listMembers(spaceId: string): Promise<SpaceMember[]> {
  return (
    await apiRequest(`/api/v1/spaces/${spaceId}/members`, spaceMemberListResponseSchema)
  ).members;
}

export async function addMember(
  spaceId: string,
  input: AddSpaceMemberInput,
): Promise<SpaceMember> {
  return (
    await apiRequest(`/api/v1/spaces/${spaceId}/members`, spaceMemberResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [201],
    })
  ).member;
}

export async function removeMember(spaceId: string, userId: string): Promise<void> {
  await apiRequest(`/api/v1/spaces/${spaceId}/members/${userId}`, z.undefined(), {
    method: "DELETE",
    acceptedStatuses: [204],
  });
}

