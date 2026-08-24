import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

const validRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const candidate = request.header("x-request-id");
  const requestId = candidate && validRequestId.test(candidate) ? candidate : randomUUID();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
}
