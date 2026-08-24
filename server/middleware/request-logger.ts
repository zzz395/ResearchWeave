import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

export function createRequestLogger(logger: Logger) {
  return function requestLogger(request: Request, response: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      logger.info(
        {
          requestId: String(response.locals.requestId),
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        "request completed",
      );
    });

    next();
  };
}
