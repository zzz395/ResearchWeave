import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { AuthProvider } from "../features/auth/auth-context";
import { queryClient } from "./query-client";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
