import { ApiClientError } from "../../services/api/client";

export type PaperComparisonErrorSurface = "page" | "selection" | "result";
export type PaperComparisonErrorAction =
  | "back_to_spaces"
  | "refresh_selection"
  | "change_selection"
  | "retry"
  | "none";

export interface PaperComparisonErrorPresentation {
  title: string;
  message: string;
  requestId?: string;
  surface: PaperComparisonErrorSurface;
  action: PaperComparisonErrorAction;
  canRetry: boolean;
}

export function shouldRetryPaperComparisonSavedPapers(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof ApiClientError && error.code === "space_not_found") return false;
  return failureCount < 1;
}

type PresentationWithoutRequestId = Omit<PaperComparisonErrorPresentation, "requestId">;

const DEFAULT_PRESENTATION: PresentationWithoutRequestId = {
  title: "Comparison could not be generated",
  message: "ResearchWeave could not generate this comparison. Please try again.",
  surface: "result",
  action: "retry",
  canRetry: true,
};

const ERROR_PRESENTATIONS: Record<string, PresentationWithoutRequestId> = {
  space_not_found: {
    title: "Space is unavailable",
    message: "This space is no longer available or your access may have changed.",
    surface: "page",
    action: "back_to_spaces",
    canRetry: false,
  },
  comparison_papers_not_found: {
    title: "Selected papers are unavailable",
    message:
      "One or more selected papers are unavailable in this Space. Refresh Saved Papers and review your selection.",
    surface: "selection",
    action: "refresh_selection",
    canRetry: false,
  },
  comparison_source_unavailable: {
    title: "Abstract evidence is unavailable",
    message:
      "One or more selected papers do not have usable metadata and abstract evidence. Choose a different selection.",
    surface: "selection",
    action: "change_selection",
    canRetry: false,
  },
  comparison_rate_limited: {
    title: "Comparison limit reached",
    message: "Too many comparison requests have been made. Please try again later.",
    surface: "result",
    action: "none",
    canRetry: false,
  },
  comparison_unavailable: {
    title: "Paper comparison is unavailable",
    message: "Abstract-based comparison is not currently available. Please try again later.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  comparison_upstream_timeout: {
    title: "Comparison generation timed out",
    message: "The comparison provider took too long to respond. Your selection is safe to retry.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  comparison_upstream_failure: {
    title: "Comparison generation is temporarily unavailable",
    message: "ResearchWeave could not generate the comparison upstream. Please try again later.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  comparison_invalid_response: {
    title: "Comparison could not be validated",
    message: "The generated comparison could not be validated. Please try again.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  network_error: {
    title: "ResearchWeave could not be reached",
    message: "Check your connection and try generating the comparison again.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  api_contract_mismatch: {
    title: "Comparison could not be validated",
    message: "The comparison response did not match the expected contract. Please try again.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  invalid_api_response: {
    title: "Comparison response could not be read",
    message: "ResearchWeave returned an unreadable comparison response. Please try again.",
    surface: "result",
    action: "retry",
    canRetry: true,
  },
  validation_error: {
    title: "Comparison request could not be used",
    message: "Review your selected papers and try again.",
    surface: "selection",
    action: "change_selection",
    canRetry: false,
  },
  payload_too_large: {
    title: "Comparison request could not be used",
    message: "Review your selected papers and reload the page before trying again.",
    surface: "selection",
    action: "change_selection",
    canRetry: false,
  },
  origin_not_allowed: {
    title: "Comparison request was not accepted",
    message: "Reload ResearchWeave before trying again.",
    surface: "result",
    action: "none",
    canRetry: false,
  },
};

const SESSION_ENDED_PRESENTATION: PresentationWithoutRequestId = {
  title: "Your session has ended",
  message: "Sign in again to continue comparing papers.",
  surface: "result",
  action: "none",
  canRetry: false,
};

export function mapPaperComparisonError(error: unknown): PaperComparisonErrorPresentation {
  if (!(error instanceof ApiClientError)) return { ...DEFAULT_PRESENTATION };

  const presentation = error.status === 401
    ? SESSION_ENDED_PRESENTATION
    : (ERROR_PRESENTATIONS[error.code] ?? DEFAULT_PRESENTATION);

  return {
    ...presentation,
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}
