import type { Request, Response } from "express";

import type { Environment } from "../../config/env";

export const SESSION_COOKIE_NAME = "researchweave_session";

export function readSessionCookie(request: Request): string | null {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== "object" || cookies === null) return null;
  const token = (cookies as Record<string, unknown>)[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length <= 128 ? token : null;
}

export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  environment: Environment,
) {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: Response, environment: Environment) {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.NODE_ENV === "production",
    path: "/",
  });
}
