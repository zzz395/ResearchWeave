import { useQuery } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect } from "react";

import {
  cancelAuthSessionProbe,
  queryClient,
  transitionClientActor,
} from "../../app/query-client";
import {
  AUTH_EXPIRED_EVENT,
  type AuthExpiredEventDetail,
} from "../../services/api/client";
import { getSession, logout as requestLogout } from "./api/auth";
import { actorOwnership } from "./actor-ownership";
import { AuthContext, authQueryKey, type AuthContextValue } from "./auth-state";

function setPrincipal(user: AuthContextValue["user"]): void {
  cancelAuthSessionProbe();
  transitionClientActor(user?.id ?? null);
  queryClient.setQueryData(authQueryKey, user);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const sessionQuery = useQuery({
    queryKey: authQueryKey,
    queryFn: async ({ signal }) => {
      const ownership = actorOwnership.current();
      const user = await getSession(signal);
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Session probe cancelled.", "AbortError");
      }
      if (!actorOwnership.owns(ownership)) {
        throw new DOMException("Stale session probe discarded.", "AbortError");
      }
      transitionClientActor(user?.id ?? null);
      return user;
    },
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    const handleExpiredSession = (event: Event) => {
      const detail = (event as CustomEvent<AuthExpiredEventDetail>).detail;
      if (
        !detail
        || !actorOwnership.ownsGeneration(detail.actorId, detail.generation)
      ) return;
      setPrincipal(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
  }, []);

  const value: AuthContextValue = {
    user: sessionQuery.data ?? null,
    isLoading: sessionQuery.isPending,
    error: sessionQuery.error,
    setAuthenticatedUser: setPrincipal,
    logout: async () => {
      setPrincipal(null);
      try {
        await requestLogout();
      } catch {
        // Local sign-out is authoritative even when the remote acknowledgement is unavailable.
      }
    },
    retry: () => void sessionQuery.refetch(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
