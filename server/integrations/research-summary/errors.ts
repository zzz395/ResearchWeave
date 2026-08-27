export type ResearchSummaryGeneratorErrorCode =
  | "SUMMARY_UPSTREAM_TIMEOUT"
  | "SUMMARY_UPSTREAM_FAILURE"
  | "SUMMARY_INVALID_RESPONSE";

export class ResearchSummaryGeneratorError extends Error {
  readonly code: ResearchSummaryGeneratorErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ResearchSummaryGeneratorErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ResearchSummaryGeneratorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function isResearchSummaryGeneratorError(
  error: unknown,
): error is ResearchSummaryGeneratorError {
  return error instanceof ResearchSummaryGeneratorError;
}
