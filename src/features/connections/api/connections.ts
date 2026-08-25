import { z } from "zod";

import {
  connectionListResponseSchema,
  connectionResponseSchema,
  type Connection,
  type ConnectionActionInput,
  type CreateConnectionRequestInput,
} from "../../../../shared/contracts/connections";
import { apiRequest } from "../../../services/api/client";

export async function listConnections(): Promise<Connection[]> {
  return (await apiRequest("/api/v1/connections", connectionListResponseSchema)).connections;
}

export async function requestConnection(input: CreateConnectionRequestInput): Promise<Connection> {
  return (
    await apiRequest("/api/v1/connections/requests", connectionResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [201],
    })
  ).connection;
}

export async function actOnConnection(
  connectionId: string,
  input: ConnectionActionInput,
): Promise<Connection | null> {
  if (input.action === "accept") {
    return (
      await apiRequest(`/api/v1/connections/${connectionId}`, connectionResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).connection;
  }
  await apiRequest(`/api/v1/connections/${connectionId}`, z.undefined(), {
    method: "PATCH",
    body: JSON.stringify(input),
    acceptedStatuses: [204],
  });
  return null;
}

export async function removeConnection(connectionId: string): Promise<void> {
  await apiRequest(`/api/v1/connections/${connectionId}`, z.undefined(), {
    method: "DELETE",
    acceptedStatuses: [204],
  });
}

