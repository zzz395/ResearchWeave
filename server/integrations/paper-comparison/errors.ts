export type PaperComparisonGeneratorErrorCode =
  | "COMPARISON_UPSTREAM_TIMEOUT"
  | "COMPARISON_UPSTREAM_FAILURE"
  | "COMPARISON_INVALID_RESPONSE"
  | "COMPARISON_RESPONSE_TOO_LARGE";

export class PaperComparisonGeneratorError extends Error {
  readonly code: PaperComparisonGeneratorErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PaperComparisonGeneratorErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PaperComparisonGeneratorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function isPaperComparisonGeneratorError(
  error: unknown,
): error is PaperComparisonGeneratorError {
  return error instanceof PaperComparisonGeneratorError;
}
