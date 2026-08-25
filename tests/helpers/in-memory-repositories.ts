import type { SpaceRole } from "../../shared/contracts/spaces";
import type {
  ResearchSpaceRecord,
  SessionRecord,
  UserRecord,
} from "../../server/db/schema";
import type {
  AuthRepository,
  NewSessionRecord,
  NewUserRecord,
} from "../../server/modules/auth/repository";
import type {
  AccessibleSpaceRecord,
  NewSpaceRecord,
  SpaceRepository,
} from "../../server/modules/spaces/repository";

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();

  findUserByEmail(email: string) {
    return Promise.resolve([...this.users.values()].find((user) => user.email === email) ?? null);
  }

  createUser(user: NewUserRecord) {
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  createSession(session: NewSessionRecord) {
    this.sessions.set(session.tokenHash, session);
    return Promise.resolve();
  }

  findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return Promise.resolve(null);
    return Promise.resolve(this.users.get(session.userId) ?? null);
  }

  deleteSessionByHash(tokenHash: string) {
    this.sessions.delete(tokenHash);
    return Promise.resolve();
  }
}

export class InMemorySpaceRepository implements SpaceRepository {
  readonly spaces = new Map<string, ResearchSpaceRecord>();
  readonly memberships = new Map<string, SpaceRole>();

  private membershipKey(spaceId: string, userId: string) {
    return `${spaceId}:${userId}`;
  }

  addMember(spaceId: string, userId: string, role: SpaceRole = "member") {
    this.memberships.set(this.membershipKey(spaceId, userId), role);
  }

  hasMembership(spaceId: string, userId: string) {
    return this.memberships.has(this.membershipKey(spaceId, userId));
  }

  listForUser(userId: string) {
    const spaces = [...this.spaces.values()]
      .flatMap((space) => {
        const role = this.memberships.get(this.membershipKey(space.id, userId));
        return role ? [{ ...space, role } satisfies AccessibleSpaceRecord] : [];
      })
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return Promise.resolve(spaces);
  }

  findForMember(spaceId: string, userId: string) {
    const space = this.spaces.get(spaceId);
    const role = this.memberships.get(this.membershipKey(spaceId, userId));
    return Promise.resolve(space && role ? { ...space, role } : null);
  }

  createForOwner(space: NewSpaceRecord) {
    this.spaces.set(space.id, space);
    this.addMember(space.id, space.ownerId, "owner");
    return Promise.resolve({ ...space, role: "owner" as const });
  }

  updateForOwner(
    spaceId: string,
    ownerId: string,
    changes: Partial<Pick<NewSpaceRecord, "name" | "description" | "updatedAt">>,
  ) {
    const space = this.spaces.get(spaceId);
    if (!space || space.ownerId !== ownerId) return Promise.resolve(null);
    const updated = { ...space, ...changes };
    this.spaces.set(spaceId, updated);
    return Promise.resolve(updated);
  }

  deleteForOwner(spaceId: string, ownerId: string) {
    const space = this.spaces.get(spaceId);
    if (!space || space.ownerId !== ownerId) return Promise.resolve(false);
    this.spaces.delete(spaceId);
    for (const key of this.memberships.keys()) {
      if (key.startsWith(`${spaceId}:`)) this.memberships.delete(key);
    }
    return Promise.resolve(true);
  }
}
