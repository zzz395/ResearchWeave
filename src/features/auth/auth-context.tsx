import { useQuery } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect } from "react";

import { queryClient } from "../../app/query-client";
import { AUTH_EXPIRED_EVENT } from "../../services/api/client";
import { getSession, logout as requestLogout } from "./api/auth";
import { AuthContext, authQueryKey, type AuthContextValue } from "./auth-state";

export function AuthProvider({ children }: PropsWithChildren) {
  const sessionQuery = useQuery({
    queryKey: authQueryKey,
    queryFn: getSession,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    const handleExpiredSession = () => {
      queryClient.setQueryData(authQueryKey, null);
      queryClient.removeQueries({ queryKey: ["spaces"] });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
  }, []);

  const value: AuthContextValue = {
    user: sessionQuery.data ?? null,
    isLoading: sessionQuery.isPending,
    error: sessionQuery.error,
    setAuthenticatedUser: (user) => queryClient.setQueryData(authQueryKey, user),
    logout: async () => {
      await requestLogout();
      queryClient.setQueryData(authQueryKey, null);
      queryClient.removeQueries({ queryKey: ["spaces"] });
    },
    retry: () => void sessionQuery.refetch(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
