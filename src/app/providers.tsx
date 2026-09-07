import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { AuthProvider } from "../features/auth/auth-context";
import { useAuth } from "../features/auth/auth-state";
import { RealtimeProvider } from "../services/realtime/realtime-provider";
import { queryClient } from "./query-client";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActorOwnedProviders>{children}</ActorOwnedProviders>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ActorOwnedProviders({ children }: PropsWithChildren) {
  const { user } = useAuth();
  return (
    <RealtimeProvider key={user?.id ?? "anonymous"}>
      {children}
    </RealtimeProvider>
  );
}
