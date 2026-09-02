import { AlertCircle, LoaderCircle } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

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
    <div className="rw-page-state" aria-busy="true" aria-live="polite" role="status">
      <div className="rw-skeleton rw-skeleton--title" />
      <div className="rw-skeleton rw-skeleton--line" />
      <div className="rw-skeleton rw-skeleton--panel" />
      <span className="rw-visually-hidden">{label}</span>
    </div>
  );
}

export function QueryState({
  status,
  label,
  onRetry,
  className = "",
}: {
  status: "loading" | "error";
  label: string;
  onRetry?: () => void;
  className?: string;
}) {
  const classes = ["rw-query-state", `rw-query-state--${status}`, className]
    .filter(Boolean)
    .join(" ");

  if (status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className={classes} role="status">
        <LoadingLabel>{label}</LoadingLabel>
      </div>
    );
  }

  return (
    <div className={classes} role="alert">
      <p>{label}</p>
      {onRetry ? (
        <button className="rw-text-action" onClick={onRetry} type="button">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return <div className={["rw-empty-state-shell", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function SectionHeader({
  title,
  count,
  action,
  headingLevel = 2,
  headingId,
  className = "",
}: {
  title: string;
  count?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  headingId?: string;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={["rw-section-header", className].filter(Boolean).join(" ")}>
      <div className="rw-section-header__title">
        <Heading id={headingId}>{title}</Heading>
        {count === undefined ? null : <span className="rw-section-header__count">{count}</span>}
      </div>
      {action ? <div className="rw-section-header__action">{action}</div> : null}
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
