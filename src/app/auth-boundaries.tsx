import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";

import { Button } from "../components/ui/button";
import { ErrorPanel, PageLoading } from "../components/ui/feedback";
import { useAuth } from "../features/auth/auth-state";
import { safeReturnPath } from "../features/auth/safe-return-path";

export function AuthResolution() {
  const { user, isLoading, error, retry } = useAuth();
  if (isLoading) return <FullPageLoading />;
  if (error) return <AuthLoadError onRetry={retry} />;
  return <Navigate replace to={user ? "/spaces" : "/login"} />;
}

export function ProtectedBoundary() {
  const { user, isLoading, error, retry } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (error) return <AuthLoadError onRetry={retry} />;
  if (!user) {
    const intended = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to={`/login?returnTo=${encodeURIComponent(intended)}`} />;
  }
  return <Outlet />;
}

export function AnonymousBoundary() {
  const { user, isLoading, error, retry } = useAuth();
  const [searchParams] = useSearchParams();
  if (isLoading) return <FullPageLoading />;
  if (error) return <AuthLoadError onRetry={retry} />;
  if (user) return <Navigate replace to={safeReturnPath(searchParams.get("returnTo"))} />;
  return <Outlet />;
}

function FullPageLoading() {
  return (
    <main className="rw-auth-resolution">
      <PageLoading label="Checking your secure session" />
    </main>
  );
}

function AuthLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="rw-auth-resolution">
      <ErrorPanel
        title="Session check unavailable"
        message="ResearchWeave could not verify your session. Your credentials have not been changed."
      />
      <Button onClick={onRetry}>Try again</Button>
    </main>
  );
}
