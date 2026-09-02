import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileDown } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../../components/ui/button";
import { ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ContentSection } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import { researchQueryKeys } from "../api/query-keys";
import { getResearchPaper } from "../api/research";
import { AuthorLine, CategoryList, ExternalPaperLink } from "../components/paper-presentation";
import { SavePaperDialog } from "../components/save-paper-dialog";
import { PaperAiSummary } from "../components/paper-ai-summary";
import { getResearchError } from "../research-errors";

interface ResearchLocationState {
  researchReturnSearch?: unknown;
}

export function PaperAbstract({ abstract }: { abstract: string }) {
  return (
    <section aria-labelledby="paper-abstract-heading">
      <h2 id="paper-abstract-heading">Abstract</h2>
      <p>{abstract}</p>
    </section>
  );
}

export function Component() {
  const { paperId = "" } = useParams();
  const location = useLocation();
  const validPaperId = z.string().uuid().safeParse(paperId).success;
  const paperQuery = useQuery({
    queryKey: researchQueryKeys.paper(paperId),
    queryFn: () => getResearchPaper(paperId),
    enabled: validPaperId,
  });
  const state = location.state as ResearchLocationState | null;
  const returnSearch = typeof state?.researchReturnSearch === "string"
    && state.researchReturnSearch.startsWith("?")
    ? state.researchReturnSearch
    : "";

  if (!validPaperId) {
    return <ContentSection><ErrorPanel message="The paper identifier is not valid." title="Paper not found" /></ContentSection>;
  }
  if (paperQuery.isPending) return <PageLoading label="Loading paper" />;
  if (paperQuery.error || !paperQuery.data) {
    const error = getResearchError(paperQuery.error);
    return (
      <ContentSection>
        <Button asChild className="rw-back-link" variant="ghost">
          <Link to={`/research${returnSearch}`}><ArrowLeft aria-hidden="true" size={16} />Back to research</Link>
        </Button>
        <ErrorPanel
          message={error.message}
          onRetry={() => void paperQuery.refetch()}
          requestId={error.requestId}
          title={error.title}
        />
      </ContentSection>
    );
  }

  const paper = paperQuery.data;
  return (
    <ContentSection>
      <Button asChild className="rw-back-link" variant="ghost">
        <Link to={`/research${returnSearch}`}><ArrowLeft aria-hidden="true" size={16} />Back to research</Link>
      </Button>
      <article className="rw-paper-detail">
        <header>
          <div className="rw-paper-detail__index">
            <span>{paper.canonicalArxivId}</span>
            <span>Version {paper.version}</span>
          </div>
          <h1>{paper.title}</h1>
          <p className="rw-paper-detail__authors"><AuthorLine authors={paper.authors} /></p>
          <CategoryList categories={paper.categories} primaryCategory={paper.primaryCategory} />
          <div className="rw-action-group rw-paper-detail__actions">
            <SavePaperDialog paper={paper} />
            <ExternalPaperLink href={paper.absUrl} />
            <Button asChild variant="secondary">
              <a href={paper.pdfUrl} rel="noreferrer" target="_blank">PDF<FileDown aria-hidden="true" size={16} /></a>
            </Button>
          </div>
        </header>
        <div className="rw-paper-detail__body">
          <PaperAbstract abstract={paper.abstract} />
          <aside>
            <h2>Paper record</h2>
            <dl>
              <div><dt>Published</dt><dd><time dateTime={paper.publishedAt}>{formatResearchDate(paper.publishedAt)}</time></dd></div>
              <div><dt>Updated</dt><dd><time dateTime={paper.updatedAt}>{formatResearchDate(paper.updatedAt)}</time></dd></div>
              <div><dt>Fetched</dt><dd><time dateTime={paper.fetchedAt}>{formatResearchDate(paper.fetchedAt)}</time></dd></div>
              {paper.doi ? <div><dt>DOI</dt><dd>{paper.doi}</dd></div> : null}
              {paper.journalRef ? <div><dt>Journal reference</dt><dd>{paper.journalRef}</dd></div> : null}
              {paper.comment ? <div><dt>Comment</dt><dd>{paper.comment}</dd></div> : null}
            </dl>
          </aside>
        </div>
        <PaperAiSummary paperId={paper.id} />
      </article>
    </ContentSection>
  );
}
