import { Router } from "express";
import rateLimit from "express-rate-limit";

import {
  authResponseSchema,
  loginInputSchema,
  registerInputSchema,
} from "../../../shared/contracts/auth";
import type { Environment } from "../../config/env";
import { requireActor, requireAuthentication } from "./middleware";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "./session-cookie";
import type { AuthService } from "./service";

interface AuthRouterDependencies {
  authService: AuthService;
  environment: Environment;
}

export function createAuthRouter({ authService, environment }: AuthRouterDependencies) {
  const router = Router();
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: "auth_rate_limited",
          message: "Too many authentication attempts. Try again later.",
          requestId: String(response.locals.requestId ?? "unknown"),
        },
      });
    },
  });

  router.post("/register", authRateLimit, async (request, response) => {
    const input = registerInputSchema.parse(request.body);
    const session = await authService.register(input);
    setSessionCookie(response, session.token, session.expiresAt, environment);
    response.status(201).json(authResponseSchema.parse({ user: session.user }));
  });

  router.post("/login", authRateLimit, async (request, response) => {
    const input = loginInputSchema.parse(request.body);
    const session = await authService.login(input);
    setSessionCookie(response, session.token, session.expiresAt, environment);
    response.status(200).json(authResponseSchema.parse({ user: session.user }));
  });

  router.get("/session", requireAuthentication, (request, response) => {
    response.status(200).json(authResponseSchema.parse({ user: requireActor(request) }));
  });

  router.post("/logout", async (request, response) => {
    const token = readSessionCookie(request);
    if (token) await authService.logout(token);
    clearSessionCookie(response, environment);
    response.status(204).end();
  });

  return router;
}
