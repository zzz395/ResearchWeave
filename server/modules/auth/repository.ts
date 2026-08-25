import { and, eq, gt } from "drizzle-orm";

import type { Database } from "../../db/client";
import { sessions, users, type UserRecord } from "../../db/schema";

export interface NewUserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(user: NewUserRecord): Promise<UserRecord>;
  createSession(session: NewSessionRecord): Promise<void>;
  findUserBySessionHash(tokenHash: string, now: Date): Promise<UserRecord | null>;
  deleteSessionByHash(tokenHash: string): Promise<void>;
}

export class DuplicateEmailRepositoryError extends Error {
  constructor() {
    super("A user with this email already exists.");
    this.name = "DuplicateEmailRepositoryError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export function createDrizzleAuthRepository(database: Database): AuthRepository {
  const db = database.db;

  return {
    async findUserByEmail(email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    },

    async createUser(user) {
      try {
        const [created] = await db.insert(users).values(user).returning();
        if (!created) throw new Error("User insert returned no record.");
        return created;
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new DuplicateEmailRepositoryError();
        throw error;
      }
    },

    async createSession(session) {
      await db.insert(sessions).values(session);
    },

    async findUserBySessionHash(tokenHash, now) {
      const [row] = await db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row?.user ?? null;
    },

    async deleteSessionByHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
