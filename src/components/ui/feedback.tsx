import { AlertCircle, LoaderCircle } from "lucide-react";
import type { PropsWithChildren } from "react";

export function Alert({ children }: PropsWithChildren) {
  return (
    <div className="rw-alert" role="alert">
      <AlertCircle aria-hidden="true" size={18} />
      <div>{children}</div>
    </div>
  );
}

export function LoadingLabel({ children }: PropsWithChildren) {
  return (
    <span className="rw-loading-label">
      <LoaderCircle aria-hidden="true" className="rw-spinner" size={17} />
      {children}
    </span>
  );
}

export function PageLoading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="rw-page-state" aria-busy="true" aria-live="polite">
      <div className="rw-skeleton rw-skeleton--title" />
      <div className="rw-skeleton rw-skeleton--line" />
      <div className="rw-skeleton rw-skeleton--panel" />
      <span className="rw-visually-hidden">{label}</span>
    </div>
  );
}

export function ErrorPanel({
  title = "We couldn't load this page",
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="rw-error-panel" role="alert">
      <span className="rw-error-panel__mark" aria-hidden="true">!</span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {requestId ? <p className="rw-request-id">Request ID: {requestId}</p> : null}
        {onRetry ? (
          <button className="rw-text-action" onClick={onRetry} type="button">
            Try again
          </button>
        ) : null}
      </div>
    </section>
  );
}
