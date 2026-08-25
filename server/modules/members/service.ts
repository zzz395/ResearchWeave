import type { AddSpaceMemberInput, SpaceMember } from "../../../shared/contracts/members";
import type { User } from "../../../shared/contracts/auth";
import { AppError } from "../../middleware/app-error";
import type { ConnectionRepository } from "../connections/repository";
import type { SpaceRepository } from "../spaces/repository";
import type { MemberRepository, MemberWithUser } from "./repository";

export interface MembershipAccessEvents {
  memberRemoved?(spaceId: string, userId: string): void;
}

export interface MemberService {
  listMembers(spaceId: string, actorId: string): Promise<SpaceMember[]>;
  addMember(spaceId: string, actorId: string, input: AddSpaceMemberInput): Promise<SpaceMember>;
  removeMember(spaceId: string, actorId: string, targetUserId: string): Promise<void>;
}

function toUser(record: MemberWithUser["user"]): User {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    createdAt: record.createdAt.toISOString(),
  };
}

function toMember(record: MemberWithUser): SpaceMember {
  return {
    user: toUser(record.user),
    role: record.role,
    joinedAt: record.joinedAt.toISOString(),
  };
}

export function createMemberService(
  repository: MemberRepository,
  spaces: SpaceRepository,
  connections: ConnectionRepository,
  events: MembershipAccessEvents = {},
): MemberService {
  return {
    async listMembers(spaceId, actorId) {
      const space = await spaces.findForMember(spaceId, actorId);
      if (!space) throw new AppError(404, "space_not_found", "Research space was not found.");
      return (await repository.list(spaceId)).map(toMember);
    },

    async addMember(spaceId, actorId, input) {
      const space = await spaces.findForMember(spaceId, actorId);
      if (!space) throw new AppError(404, "space_not_found", "Research space was not found.");
      if (space.role !== "owner") {
        throw new AppError(403, "space_forbidden", "Only the space owner can add members.");
      }
      if (input.userId === actorId) {
        throw new AppError(409, "space_member_exists", "This user is already a member.");
      }
      const user = await connections.findUserById(input.userId);
      if (!user) throw new AppError(404, "connection_not_found", "Accepted connection was not found.");
      if (!(await connections.areAccepted(actorId, input.userId))) {
        throw new AppError(403, "accepted_connection_required", "Only accepted connections can be added to a space.");
      }
      const member = await repository.add(spaceId, input.userId, new Date());
      if (!member) throw new AppError(409, "space_member_exists", "This user is already a member.");
      return toMember(member);
    },

    async removeMember(spaceId, actorId, targetUserId) {
      const actorMembership = await spaces.findForMember(spaceId, actorId);
      if (!actorMembership) {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      const target = await repository.find(spaceId, targetUserId);
      if (!target) throw new AppError(404, "space_member_not_found", "Space member was not found.");
      if (target.role === "owner") {
        throw new AppError(403, "space_owner_cannot_leave", "The space owner cannot leave or be removed.");
      }
      const isSelf = actorId === targetUserId;
      if (!isSelf && actorMembership.role !== "owner") {
        throw new AppError(403, "space_forbidden", "Only the space owner can remove another member.");
      }
      if (!(await repository.removeOrdinaryMember(spaceId, targetUserId))) {
        throw new AppError(409, "space_membership_conflict", "The membership changed before removal completed.");
      }
      events.memberRemoved?.(spaceId, targetUserId);
    },
  };
}

