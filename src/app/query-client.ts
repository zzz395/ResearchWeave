import { QueryClient, type QueryKey } from "@tanstack/react-query";

import { actorOwnership } from "../features/auth/actor-ownership";
import { authQueryKey } from "../features/auth/auth-state";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export const queryClient = createQueryClient();

function isAuthQuery(queryKey: QueryKey): boolean {
  return queryKey.length === authQueryKey.length
    && queryKey.every((part, index) => part === authQueryKey[index]);
}

export function clearProtectedClientState(client = queryClient): void {
  const protectedQuery = (query: { queryKey: QueryKey }) => !isAuthQuery(query.queryKey);
  void client.cancelQueries({ predicate: protectedQuery });
  client.removeQueries({ predicate: protectedQuery });
  client.getMutationCache().clear();
}

export function cancelAuthSessionProbe(client = queryClient): void {
  void client.cancelQueries({ queryKey: authQueryKey, exact: true });
}

export function transitionClientActor(actorId: string | null): void {
  const transition = actorOwnership.transition(actorId);
  if (!transition.changed) return;
  clearProtectedClientState();
}
