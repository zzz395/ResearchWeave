import { randomUUID } from "node:crypto";

import type {
  CreateSpaceInput,
  ResearchSpace,
  UpdateSpaceInput,
} from "../../../shared/contracts/spaces";
import { AppError } from "../../middleware/app-error";
import type { AccessibleSpaceRecord, SpaceRepository } from "./repository";

export interface SpaceService {
  listSpaces(userId: string): Promise<ResearchSpace[]>;
  getSpace(spaceId: string, userId: string): Promise<ResearchSpace>;
  createSpace(input: CreateSpaceInput, ownerId: string): Promise<ResearchSpace>;
  updateSpace(spaceId: string, input: UpdateSpaceInput, userId: string): Promise<ResearchSpace>;
  deleteSpace(spaceId: string, userId: string): Promise<void>;
}

export interface SpaceAccessEvents {
  spaceDeleted?(spaceId: string): void;
}

function toSpace(record: AccessibleSpaceRecord): ResearchSpace {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ownerId: record.ownerId,
    role: record.role,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requireOwner(record: AccessibleSpaceRecord): void {
  if (record.role !== "owner") {
    throw new AppError(403, "space_forbidden", "Only the space owner can perform this action.");
  }
}

export function createSpaceService(
  repository: SpaceRepository,
  events: SpaceAccessEvents = {},
): SpaceService {
  return {
    async listSpaces(userId) {
      return (await repository.listForUser(userId)).map(toSpace);
    },

    async getSpace(spaceId, userId) {
      const space = await repository.findForMember(spaceId, userId);
      if (!space) throw new AppError(404, "space_not_found", "Research space was not found.");
      return toSpace(space);
    },

    async createSpace(input, ownerId) {
      const now = new Date();
      const created = await repository.createForOwner({
        id: randomUUID(),
        name: input.name,
        description: input.description,
        ownerId,
        createdAt: now,
        updatedAt: now,
      });
      return toSpace(created);
    },

    async updateSpace(spaceId, input, userId) {
      const existing = await repository.findForMember(spaceId, userId);
      if (!existing) throw new AppError(404, "space_not_found", "Research space was not found.");
      requireOwner(existing);

      const updatedAt = new Date();
      const updated = await repository.updateForOwner(spaceId, userId, { ...input, updatedAt });
      if (!updated) throw new AppError(404, "space_not_found", "Research space was not found.");
      return toSpace({ ...updated, role: "owner" });
    },

    async deleteSpace(spaceId, userId) {
      const existing = await repository.findForMember(spaceId, userId);
      if (!existing) throw new AppError(404, "space_not_found", "Research space was not found.");
      requireOwner(existing);

      const deleted = await repository.deleteForOwner(spaceId, userId);
      if (!deleted) throw new AppError(404, "space_not_found", "Research space was not found.");
      events.spaceDeleted?.(spaceId);
    },
  };
}
