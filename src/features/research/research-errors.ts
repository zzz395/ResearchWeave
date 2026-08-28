import { ApiClientError } from "../../services/api/client";

export function getResearchError(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return { title: "Research could not be loaded", message: "Please try again." };
  }

  if (error.status === 400) {
    return {
      title: "Search query could not be used",
      message: "Review the query and try again.",
      requestId: error.requestId,
    };
  }
  if (error.status === 401) {
    return {
      title: "Your session has ended",
      message: "Sign in again to continue searching Research.",
      requestId: error.requestId,
    };
  }

  switch (error.code) {
    case "research_temporarily_unavailable":
      return {
        title: "Research is temporarily unavailable",
        message: "Research search is temporarily unavailable. Please wait a moment and try again.",
        requestId: error.requestId,
      };
    case "research_upstream_timeout":
      return {
        title: "arXiv took too long to respond",
        message: "The upstream search timed out. Your query is safe to retry.",
        requestId: error.requestId,
      };
    case "research_upstream_failure":
      return {
        title: "arXiv search is unavailable",
        message: "ResearchWeave could not retrieve results from arXiv. Please try again later.",
        requestId: error.requestId,
      };
    default:
      return {
        title: error.status === 404 ? "Paper not found" : "Research could not be loaded",
        message: error.message,
        requestId: error.requestId,
      };
  }
}

export function getSummaryError(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return {
      title: "Summary could not be loaded",
      message: "Please try again.",
      requestId: undefined,
    };
  }

  const messages: Record<string, { title: string; message: string }> = {
    summary_unavailable: {
      title: "Summary generation is unavailable",
      message: "Summary generation is currently unavailable.",
    },
    summary_upstream_timeout: {
      title: "Summary generation timed out",
      message: "Summary generation timed out. Please try again.",
    },
    summary_upstream_failure: {
      title: "Summary generation failed",
      message: "Summary generation failed upstream. Please try again.",
    },
    summary_invalid_response: {
      title: "Summary could not be validated",
      message: "The generated summary could not be validated. Please try again.",
    },
    summary_source_changed: {
      title: "The paper changed",
      message: "The paper changed while the summary was being generated. Please try again.",
    },
  };
  const mapped = messages[error.code];
  return {
    ...(mapped ?? {
      title: error.status === 404 ? "Paper not found" : "Summary could not be loaded",
      message: error.message,
    }),
    requestId: error.requestId,
  };
}
