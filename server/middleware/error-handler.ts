import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

import { AppError } from "./app-error";

interface HttpErrorLike {
  status?: number;
  type?: string;
}

function isPayloadTooLarge(error: unknown): error is HttpErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    ("status" in error || "type" in error) &&
    ((error as HttpErrorLike).status === 413 ||
      (error as HttpErrorLike).type === "entity.too.large")
  );
}

export function createNotFoundHandler(): RequestHandler {
  return (request, _response, next) => {
    next(new AppError(404, "not_found", `Route ${request.method} ${request.path} was not found.`));
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    // Express identifies error middleware by its four-argument signature.
    void next;
    const requestId = String(response.locals.requestId ?? "unknown");

    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "validation_error",
          message: "The request did not match the expected structure.",
          requestId,
          details: error.flatten(),
        },
      });
      return;
    }

    if (isPayloadTooLarge(error)) {
      response.status(413).json({
        error: {
          code: "payload_too_large",
          message: "The request payload exceeds the allowed size.",
          requestId,
        },
      });
      return;
    }

    logger.error(
      {
        requestId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "unhandled request error",
    );

    response.status(500).json({
      error: {
        code: "internal_server_error",
        message: "An unexpected server error occurred.",
        requestId,
      },
    });
  };
}
