import { z } from "zod";

import {
  authResponseSchema,
  type LoginInput,
  type RegisterInput,
  type User,
} from "../../../../shared/contracts/auth";
import { ApiClientError, apiRequest } from "../../../services/api/client";

export async function getSession(): Promise<User | null> {
  try {
    return (await apiRequest("/api/v1/auth/session", authResponseSchema)).user;
  } catch (error: unknown) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export async function login(input: LoginInput): Promise<User> {
  return (
    await apiRequest("/api/v1/auth/login", authResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).user;
}

export async function register(input: RegisterInput): Promise<User> {
  return (
    await apiRequest("/api/v1/auth/register", authResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      acceptedStatuses: [201],
    })
  ).user;
}

export async function logout(): Promise<void> {
  await apiRequest("/api/v1/auth/logout", z.undefined(), {
    method: "POST",
    acceptedStatuses: [204],
  });
}
