import { ApiClientError } from "../../services/api/client";

export interface AskKnowledgeErrorPresentation {
  title: string;
  message: string;
  requestId?: string;
}

export function mapAskKnowledgeError(error: unknown): AskKnowledgeErrorPresentation {
  if (!(error instanceof ApiClientError)) {
    return {
      title: "Answer could not be generated",
      message: "Please try asking your question again.",
    };
  }

  const messages: Record<string, { title: string; message: string }> = {
    knowledge_not_indexed: {
      title: "Knowledge is not indexed yet",
      message: "Index at least one document before asking questions.",
    },
    knowledge_embedding_incompatible: {
      title: "Knowledge indexes are incompatible",
      message: "The active knowledge indexes are not compatible with the current embedding configuration. Reindex the affected documents before asking questions.",
    },
    space_not_found: {
      title: "Space is unavailable",
      message: "This space is no longer available or your access may have changed.",
    },
    answer_generation_unavailable: {
      title: "Answer generation is unavailable",
      message: "Answer generation is not currently configured or available. Please try again later.",
    },
    answer_upstream_timeout: {
      title: "Answer generation timed out",
      message: "The answer provider took too long to respond. Your question is safe to retry.",
    },
    answer_upstream_failure: {
      title: "Answer generation is temporarily unavailable",
      message: "ResearchWeave could not generate an answer upstream. Please try again later.",
    },
    answer_invalid_response: {
      title: "Answer could not be validated",
      message: "The generated answer could not be validated. Please try again.",
    },
    network_error: {
      title: "ResearchWeave could not be reached",
      message: "Check your connection and try asking the question again.",
    },
    api_contract_mismatch: {
      title: "Answer could not be validated",
      message: "The answer response did not match the expected contract. Please try again.",
    },
  };
  const mapped = messages[error.code];
  return {
    ...(mapped ?? {
      title: "Answer could not be generated",
      message: error.message,
    }),
    requestId: error.requestId,
  };
}
