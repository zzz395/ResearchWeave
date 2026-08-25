import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="ResearchWeave · Research Spaces" className="rw-brand" to="/spaces">
      <span className="rw-brand__mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact ? <span>ResearchWeave</span> : null}
    </Link>
  );
}
