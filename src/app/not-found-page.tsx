import { Link } from "react-router-dom";

export function Component() {
  return (
    <main className="not-found-page">
      <div className="not-found-card">
        <p className="overline">404 · Not found</p>
        <h1>This route has not been woven.</h1>
        <p>The page you requested does not exist or is not available in this release.</p>
        <Link to="/">Return to ResearchWeave</Link>
      </div>
    </main>
  );
}
