import { randomUUID } from "node:crypto";

import type {
  Connection,
  ConnectionActionInput,
  CreateConnectionRequestInput,
} from "../../../shared/contracts/connections";
import type { User } from "../../../shared/contracts/auth";
import { AppError } from "../../middleware/app-error";
import {
  DuplicateConnectionRepositoryError,
  type ConnectionRepository,
  type ConnectionWithOtherUser,
} from "./repository";

function toUser(record: ConnectionWithOtherUser["otherUser"]): User {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    createdAt: record.createdAt.toISOString(),
  };
}

function toConnection(record: ConnectionWithOtherUser): Connection {
  return {
    id: record.id,
    status: record.status,
    requestedByUserId: record.requestedByUserId,
    otherUser: toUser(record.otherUser),
    createdAt: record.createdAt.toISOString(),
    respondedAt: record.respondedAt?.toISOString() ?? null,
  };
}

export interface ConnectionService {
  listConnections(actorId: string): Promise<Connection[]>;
  requestConnection(actorId: string, input: CreateConnectionRequestInput): Promise<Connection>;
  actOnConnection(actorId: string, connectionId: string, input: ConnectionActionInput): Promise<Connection | null>;
  removeConnection(actorId: string, connectionId: string): Promise<void>;
}

export function createConnectionService(repository: ConnectionRepository): ConnectionService {
  async function getView(actorId: string, connectionId: string): Promise<Connection> {
    const connection = (await repository.listForUser(actorId)).find((item) => item.id === connectionId);
    if (!connection) throw new AppError(404, "connection_not_found", "Connection was not found.");
    return toConnection(connection);
  }

  return {
    async listConnections(actorId) {
      return (await repository.listForUser(actorId)).map(toConnection);
    },

    async requestConnection(actorId, input) {
      const otherUser = await repository.findUserByEmail(input.email);
      if (!otherUser) {
        throw new AppError(404, "connection_user_not_found", "No account was found for that email.");
      }
      if (otherUser.id === actorId) {
        throw new AppError(400, "connection_self_not_allowed", "You cannot connect with yourself.");
      }

      const [userLowId, userHighId] = [actorId, otherUser.id].sort();
      try {
        const created = await repository.createRequest({
          id: randomUUID(),
          userLowId,
          userHighId,
          requestedByUserId: actorId,
          status: "pending",
          createdAt: new Date(),
          respondedAt: null,
        });
        return toConnection({ ...created, otherUser });
      } catch (error: unknown) {
        if (error instanceof DuplicateConnectionRepositoryError) {
          throw new AppError(409, "connection_already_exists", "A connection already exists with this user.");
        }
        throw error;
      }
    },

    async actOnConnection(actorId, connectionId, input) {
      const existing = await repository.findForParticipant(connectionId, actorId);
      if (!existing) throw new AppError(404, "connection_not_found", "Connection was not found.");
      if (existing.status !== "pending") {
        throw new AppError(409, "connection_state_conflict", "This connection request is no longer pending.");
      }

      const isRequester = existing.requestedByUserId === actorId;
      let changed: boolean;
      if (input.action === "accept") {
        if (isRequester) throw new AppError(403, "connection_action_forbidden", "Only the recipient can accept this request.");
        changed = await repository.acceptPending(connectionId, actorId, new Date());
      } else if (input.action === "reject") {
        if (isRequester) throw new AppError(403, "connection_action_forbidden", "Only the recipient can reject this request.");
        changed = await repository.deletePending(connectionId, actorId, false);
      } else {
        if (!isRequester) throw new AppError(403, "connection_action_forbidden", "Only the requester can cancel this request.");
        changed = await repository.deletePending(connectionId, actorId, true);
      }
      if (!changed) throw new AppError(409, "connection_state_conflict", "The connection changed before this action completed.");
      return input.action === "accept" ? getView(actorId, connectionId) : null;
    },

    async removeConnection(actorId, connectionId) {
      const existing = await repository.findForParticipant(connectionId, actorId);
      if (!existing) throw new AppError(404, "connection_not_found", "Connection was not found.");
      if (existing.status !== "accepted") {
        throw new AppError(409, "connection_state_conflict", "Only accepted connections can be removed.");
      }
      if (!(await repository.deleteAccepted(connectionId, actorId))) {
        throw new AppError(409, "connection_state_conflict", "The connection changed before removal completed.");
      }
    },
  };
}
