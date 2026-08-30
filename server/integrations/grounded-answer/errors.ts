export type GroundedAnswerGeneratorErrorCode =
  | "ANSWER_UPSTREAM_TIMEOUT"
  | "ANSWER_UPSTREAM_FAILURE"
  | "ANSWER_UPSTREAM_REJECTED"
  | "ANSWER_INVALID_RESPONSE"
  | "ANSWER_RESPONSE_TOO_LARGE";

export class GroundedAnswerGeneratorError extends Error {
  readonly code: GroundedAnswerGeneratorErrorCode;
  readonly retryable: boolean;

  constructor(
    code: GroundedAnswerGeneratorErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GroundedAnswerGeneratorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function isGroundedAnswerGeneratorError(
  error: unknown,
): error is GroundedAnswerGeneratorError {
  return error instanceof GroundedAnswerGeneratorError;
}
