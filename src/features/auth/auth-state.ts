import { createContext, useContext } from "react";

import type { User } from "../../../shared/contracts/auth";

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  error: Error | null;
  setAuthenticatedUser: (user: User) => void;
  logout: () => Promise<void>;
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
export const authQueryKey = ["auth", "session"] as const;

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
