import type { RequestHandler } from "express";

import type { Environment } from "../config/env";
import { AppError } from "./app-error";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function createOriginGuard(environment: Environment): RequestHandler {
  const trustedOrigin = new URL(environment.CLIENT_ORIGIN).origin;

  return (request, _response, next) => {
    if (safeMethods.has(request.method)) {
      next();
      return;
    }

    const origin = request.header("origin");
    if (!origin || origin !== trustedOrigin) {
      next(new AppError(403, "origin_not_allowed", "The request origin is not allowed."));
      return;
    }

    next();
  };
}
