import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

export function createRequestLogger(logger: Logger) {
  return function requestLogger(request: Request, response: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();
    const method = request.method;
    const path = request.path;

    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      logger.info(
        {
          requestId: String(response.locals.requestId),
          method,
          path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        "request completed",
      );
    });

    next();
  };
}
