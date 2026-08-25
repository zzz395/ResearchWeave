import { ChevronRight } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="rw-page-header">
      <div>
        {kicker ? <p className="rw-page-kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="rw-page-header__action">{action}</div> : null}
    </header>
  );
}

export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="rw-breadcrumb">
      <Link to="/spaces">Research Spaces</Link>
      <ChevronRight aria-hidden="true" size={14} />
      <span aria-current="page">{current}</span>
    </nav>
  );
}

export function ContentSection({ children }: PropsWithChildren) {
  return <div className="rw-content-section">{children}</div>;
}
