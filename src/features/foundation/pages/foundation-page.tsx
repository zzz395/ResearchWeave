import { useHealthQuery } from "../api/use-health-query";

type ConnectionState = "checking" | "healthy" | "degraded" | "unreachable";

interface StatusCopy {
  eyebrow: string;
  title: string;
  detail: string;
}

const statusCopy: Record<ConnectionState, StatusCopy> = {
  checking: {
    eyebrow: "Checking live dependencies",
    title: "Establishing the request path",
    detail: "The client is asking the versioned API to verify its PostgreSQL connection.",
  },
  healthy: {
    eyebrow: "Live foundation check",
    title: "Backend and database are available",
    detail: "Express completed a real SELECT 1 probe against PostgreSQL.",
  },
  degraded: {
    eyebrow: "Live foundation check",
    title: "Backend available, database unavailable",
    detail: "The API is responding, but its PostgreSQL probe did not complete successfully.",
  },
  unreachable: {
    eyebrow: "Connection unavailable",
    title: "The backend could not be reached",
    detail: "Start the development server, then retry this real health request.",
  },
};

export function FoundationPage() {
  const healthQuery = useHealthQuery();
  const state: ConnectionState = healthQuery.isPending
    ? "checking"
    : healthQuery.isError
      ? "unreachable"
      : healthQuery.data.status === "ok"
        ? "healthy"
        : "degraded";
  const copy = statusCopy[state];

  return (
    <main className="foundation-page">
      <div className="paper-grid" aria-hidden="true" />

      <header className="site-header">
        <a className="wordmark" href="/" aria-label="ResearchWeave home">
          <span className="wordmark-mark">RW</span>
          <span>ResearchWeave</span>
        </a>
        <span className="phase-stamp">Foundation · Phase 1</span>
      </header>

      <section className="hero" aria-labelledby="foundation-title">
        <div className="hero-index" aria-hidden="true">
          01
        </div>
        <div className="hero-copy">
          <p className="overline">Engineering foundation</p>
          <h1 id="foundation-title">ResearchWeave</h1>
          <p className="subtitle">Real-Time Research Collaboration &amp; RAG Agent Platform</p>
          <p className="intro">
            A clean full-stack starting point for evidence-aware research software. Business
            capabilities will arrive in later phases; this build verifies only the engineering
            ground beneath them.
          </p>
        </div>
      </section>

      <section className="health-section" aria-labelledby="health-title">
        <div className={`health-card health-card--${state}`}>
          <div className="health-card__heading">
            <div>
              <p className="health-eyebrow">{copy.eyebrow}</p>
              <h2 id="health-title">{copy.title}</h2>
            </div>
            <span className="status-glyph" aria-hidden="true">
              <span />
            </span>
          </div>

          <p className="health-detail">{copy.detail}</p>

          <div className="request-path" aria-label="Verified request path">
            <span>Browser</span>
            <i aria-hidden="true">→</i>
            <span>Typed API client</span>
            <i aria-hidden="true">→</i>
            <span>Express /api/v1</span>
            <i aria-hidden="true">→</i>
            <span>PostgreSQL</span>
          </div>

          <div className="health-card__footer">
            <dl className="health-facts">
              <div>
                <dt>API</dt>
                <dd>{healthQuery.isError ? "unreachable" : healthQuery.isPending ? "checking" : "available"}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{healthQuery.data?.database ?? "unknown"}</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>
                  {healthQuery.data
                    ? new Date(healthQuery.data.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "—"}
                </dd>
              </div>
            </dl>

            {(state === "degraded" || state === "unreachable") && (
              <button
                className="retry-button"
                type="button"
                onClick={() => void healthQuery.refetch()}
                disabled={healthQuery.isFetching}
              >
                {healthQuery.isFetching ? "Checking…" : "Retry check"}
              </button>
            )}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>Development foundation</span>
        <span>No business data · No simulated metrics</span>
      </footer>
    </main>
  );
}
