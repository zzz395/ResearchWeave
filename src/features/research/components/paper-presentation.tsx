import { ArrowUpRight, BookmarkPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import type { PersistentResearchPaper } from "../../../../shared/contracts/research";
import { Button } from "../../../components/ui/button";
import { formatResearchDate } from "../../spaces/format-research-date";

export function AuthorLine({ authors }: { authors: string[] }) {
  return <span>{authors.join(", ")}</span>;
}

export function CategoryList({
  categories,
  primaryCategory,
}: {
  categories: string[];
  primaryCategory: string;
}) {
  return (
    <div aria-label="Paper categories" className="rw-paper-categories">
      {categories.map((category) => (
        <span className={category === primaryCategory ? "is-primary" : ""} key={category}>
          {category}
        </span>
      ))}
    </div>
  );
}

export function PaperSummary({
  paper,
  actions,
  eyebrow,
}: {
  paper: PersistentResearchPaper;
  actions: ReactNode;
  eyebrow?: ReactNode;
}) {
  const location = useLocation();
  const researchReturnSearch = location.pathname === "/research" ? location.search : "";

  return (
    <article className="rw-paper-card">
      <div className="rw-paper-card__main">
        <div className="rw-paper-card__eyebrow">
          {eyebrow ?? <span>{paper.primaryCategory}</span>}
          <span>v{paper.version}</span>
        </div>
        <h2>
          <Link
            state={{ researchReturnSearch }}
            to={`/research/papers/${paper.id}`}
          >
            {paper.title}
          </Link>
        </h2>
        <p className="rw-paper-authors"><AuthorLine authors={paper.authors} /></p>
        <CategoryList categories={paper.categories} primaryCategory={paper.primaryCategory} />
        <p className="rw-paper-abstract-preview">{paper.abstract}</p>
        <dl className="rw-paper-card__dates">
          <div>
            <dt>Published</dt>
            <dd><time dateTime={paper.publishedAt}>{formatResearchDate(paper.publishedAt)}</time></dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd><time dateTime={paper.updatedAt}>{formatResearchDate(paper.updatedAt)}</time></dd>
          </div>
        </dl>
      </div>
      <div className="rw-paper-card__actions">
        <Button asChild variant="secondary">
          <Link
            state={{ researchReturnSearch }}
            to={`/research/papers/${paper.id}`}
          >
            View details
          </Link>
        </Button>
        {actions}
      </div>
    </article>
  );
}

export function ExternalPaperLink({
  href,
  label = "View on arXiv",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Button asChild variant="secondary">
      <a href={href} rel="noreferrer" target="_blank">
        {label}<ArrowUpRight aria-hidden="true" size={16} />
      </a>
    </Button>
  );
}

export function SavePaperAction({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick}>
      <BookmarkPlus aria-hidden="true" size={16} />Save to space
    </Button>
  );
}
