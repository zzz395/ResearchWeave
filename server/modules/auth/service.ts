import { createHash, randomBytes, randomUUID } from "node:crypto";

import { compare, hash } from "bcryptjs";

import type { LoginInput, RegisterInput, User } from "../../../shared/contracts/auth";
import { AppError } from "../../middleware/app-error";
import {
  DuplicateEmailRepositoryError,
  type AuthRepository,
  type NewUserRecord,
} from "./repository";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_COST = 12;
const INVALID_PASSWORD_HASH = "$2b$12$.80UnlqALKpq.fquiv.GtOH1EEn33jOiBnco62jliQqw3xETStuJm";

export interface IssuedSession {
  user: User;
  token: string;
  expiresAt: Date;
}

export interface AuthService {
  register(input: RegisterInput): Promise<IssuedSession>;
  login(input: LoginInput): Promise<IssuedSession>;
  getUserForSession(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
}

export interface AuthEvents {
  sessionEnded?(tokenHash: string): void;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toUser(record: NewUserRecord): User {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    createdAt: record.createdAt.toISOString(),
  };
}

export function createAuthService(repository: AuthRepository, events: AuthEvents = {}): AuthService {
  async function issueSession(user: NewUserRecord): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

    await repository.createSession({
      id: randomUUID(),
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt,
      createdAt: now,
    });

    return { user: toUser(user), token, expiresAt };
  }

  return {
    async register(input) {
      const existingUser = await repository.findUserByEmail(input.email);
      if (existingUser) {
        throw new AppError(409, "email_already_exists", "An account with this email already exists.");
      }

      const now = new Date();
      const user: NewUserRecord = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hash(input.password, PASSWORD_HASH_COST),
        createdAt: now,
        updatedAt: now,
      };

      try {
        const createdUser = await repository.createUser(user);
        return await issueSession(createdUser);
      } catch (error: unknown) {
        if (error instanceof DuplicateEmailRepositoryError) {
          throw new AppError(
            409,
            "email_already_exists",
            "An account with this email already exists.",
          );
        }
        throw error;
      }
    },

    async login(input) {
      const user = await repository.findUserByEmail(input.email);
      const passwordIsValid = await compare(
        input.password,
        user?.passwordHash ?? INVALID_PASSWORD_HASH,
      );

      if (!user || !passwordIsValid) {
        throw new AppError(401, "invalid_credentials", "Invalid email or password.");
      }

      return issueSession(user);
    },

    async getUserForSession(token) {
      if (!token) return null;
      const user = await repository.findUserBySessionHash(hashSessionToken(token), new Date());
      return user ? toUser(user) : null;
    },

    async logout(token) {
      if (!token) return;
      const tokenHash = hashSessionToken(token);
      await repository.deleteSessionByHash(tokenHash);
      events.sessionEnded?.(tokenHash);
    },
  };
}
