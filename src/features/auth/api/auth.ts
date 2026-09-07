import { z } from "zod";

import {
  authResponseSchema,
  type LoginInput,
  type RegisterInput,
  type User,
} from "../../../../shared/contracts/auth";
import { ApiClientError, apiRequest } from "../../../services/api/client";
import { runSessionMutation } from "../session-mutation";

export async function getSession(signal?: AbortSignal): Promise<User | null> {
  try {
    return (await apiRequest("/api/v1/auth/session", authResponseSchema, {
      authMode: "session",
      signal,
    })).user;
  } catch (error: unknown) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export async function login(input: LoginInput): Promise<User> {
  return runSessionMutation("login", async (signal) => (
    await apiRequest("/api/v1/auth/login", authResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      authMode: "credential",
      signal,
    })
  ).user);
}

export async function register(input: RegisterInput): Promise<User> {
  return runSessionMutation("register", async (signal) => (
    await apiRequest("/api/v1/auth/register", authResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [201],
      authMode: "credential",
      signal,
    })
  ).user);
}

export async function logout(): Promise<void> {
  await runSessionMutation("logout", (signal) => apiRequest("/api/v1/auth/logout", z.undefined(), {
    method: "POST",
    acceptedStatuses: [204],
    authMode: "session-mutation",
    signal,
  }));
}
