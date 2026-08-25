import type { RequestHandler } from "express";

import { AppError } from "../../middleware/app-error";
import { clearSessionCookie, readSessionCookie } from "./session-cookie";
import type { AuthService } from "./service";
import type { Environment } from "../../config/env";

export function createSessionMiddleware(
  authService: AuthService,
  environment: Environment,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const token = readSessionCookie(request);
      if (!token) {
        next();
        return;
      }

      const user = await authService.getUserForSession(token);
      if (user) request.actor = user;
      else clearSessionCookie(response, environment);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

export const requireAuthentication: RequestHandler = (request, _response, next) => {
  if (!request.actor) {
    next(new AppError(401, "auth_required", "Authentication is required."));
    return;
  }
  next();
};

export function requireActor(request: Express.Request) {
  if (!request.actor) throw new AppError(401, "auth_required", "Authentication is required.");
  return request.actor;
}
