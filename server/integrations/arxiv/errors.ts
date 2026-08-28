export type ArxivErrorCode =
  | "ARXIV_QUEUE_FULL"
  | "ARXIV_TIMEOUT"
  | "ARXIV_RATE_LIMITED"
  | "ARXIV_UPSTREAM_ERROR"
  | "ARXIV_RESPONSE_TOO_LARGE"
  | "ARXIV_INVALID_RESPONSE";

interface ArxivIntegrationErrorOptions {
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

export class ArxivIntegrationError extends Error {
  readonly code: ArxivErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ArxivErrorCode, message: string, options: ArxivIntegrationErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ArxivIntegrationError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isArxivIntegrationError(error: unknown): error is ArxivIntegrationError {
  return error instanceof ArxivIntegrationError;
}
