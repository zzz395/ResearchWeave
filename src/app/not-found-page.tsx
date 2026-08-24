import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <div className="not-found-card">
        <p className="overline">404 · Not found</p>
        <h1>This route has not been woven.</h1>
        <p>Phase 1 intentionally exposes only the ResearchWeave foundation.</p>
        <Link to="/">Return to the foundation</Link>
      </div>
    </main>
  );
}
