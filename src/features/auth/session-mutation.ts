import { ApiClientError } from "../../services/api/client";

type SessionMutationKind = "login" | "register" | "logout";

export const SESSION_MUTATION_TIMEOUT_MS = 15_000;

let activeSessionMutation: SessionMutationKind | null = null;

export async function runSessionMutation<T>(
  kind: SessionMutationKind,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (activeSessionMutation !== null) {
    throw new ApiClientError(
      "Another authentication request is already in progress.",
      "session_mutation_in_progress",
    );
  }

  activeSessionMutation = kind;
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new ApiClientError(
      "The authentication request timed out. Please try again.",
      "session_mutation_timeout",
    ));
  }, SESSION_MUTATION_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(deadline);
    activeSessionMutation = null;
  }
}
