import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Database, MessageSquare, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import { QueryState, SectionHeader } from "../../../components/ui/feedback";
import { documentListQueryOptions } from "../../knowledge/api/document-list-query";
import { getDocumentStatusPresentation } from "../../knowledge/document-presentation";
import { listMembers } from "../../members/api/members";
import { researchQueryKeys } from "../../research/api/query-keys";
import { listSavedPapers } from "../../research/api/research";
import { useSpaceLayout } from "../components/space-layout-context";
import { formatResearchDate } from "../format-research-date";
import {
  getOverviewDocumentCountLabel,
  isOverviewDocumentListEmpty,
  resolveOverviewCollection,
  type OverviewCollectionState,
} from "../space-overview-presentation";

function SupportingQueryState({
  state,
  label,
  onRetry,
}: {
  state: OverviewCollectionState<unknown>;
  label: string;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return <QueryState className="rw-overview-query-state" label={`Loading ${label}`} status="loading" />;
  }
  if (state.status === "error") {
    return (
      <QueryState
        className="rw-overview-query-state"
        label={`${label} could not be loaded.`}
        onRetry={onRetry}
        status="error"
      />
    );
  }
  return null;
}

export function Component() {
  const space = useSpaceLayout();
  const savedPapersQuery = useQuery({
    queryKey: researchQueryKeys.savedPapers(space.id),
    queryFn: () => listSavedPapers(space.id),
  });
  const membersQuery = useQuery({
    queryKey: ["space-members", space.id],
    queryFn: () => listMembers(space.id),
  });
  const documentsQuery = useInfiniteQuery(documentListQueryOptions(space.id));

  const savedPapersState = resolveOverviewCollection({
    data: savedPapersQuery.data,
    isError: savedPapersQuery.isError,
    isPending: savedPapersQuery.isPending,
  });
  const membersState = resolveOverviewCollection({
    data: membersQuery.data,
    isError: membersQuery.isError,
    isPending: membersQuery.isPending,
  });
  const firstDocumentPage = documentsQuery.data?.pages[0];
  const documentsState = resolveOverviewCollection({
    data: firstDocumentPage?.documents,
    isError: documentsQuery.isError,
    isPending: documentsQuery.isPending,
  });
  const documentsAreEmpty = documentsState.status === "ready" && firstDocumentPage
    ? isOverviewDocumentListEmpty({
        count: documentsState.items.length,
        nextCursor: firstDocumentPage.nextCursor,
      })
    : false;

  return (
    <div className="rw-space-tab-panel rw-space-overview">
      <section className="rw-overview-continue" aria-labelledby="continue-work-heading">
        <div>
          <p className="rw-context-label">Continue your work</p>
          <h2 id="continue-work-heading">Move from discovery to shared knowledge.</h2>
          <p>Return to the sources, grounded questions, and collaborators that make this Space useful.</p>
        </div>
        <div className="rw-action-group rw-overview-continue__actions">
          <Button asChild><Link to={`/spaces/${space.id}/knowledge`}><Database aria-hidden="true" size={16} />Ask Knowledge</Link></Button>
          <Button asChild variant="secondary"><Link to={`/spaces/${space.id}/saved-papers`}><BookOpen aria-hidden="true" size={16} />Saved Papers</Link></Button>
          <Button asChild variant="secondary"><Link to={`/spaces/${space.id}/chat`}><MessageSquare aria-hidden="true" size={16} />Open Chat</Link></Button>
        </div>
      </section>

      <div className="rw-overview-source-grid">
        <section className="rw-overview-section" aria-labelledby="overview-research-heading">
          <header>
            <h2 id="overview-research-heading">Saved papers</h2>
            {savedPapersState.status === "ready" ? <span>{savedPapersState.items.length} saved</span> : null}
          </header>
          <SupportingQueryState
            label="Saved papers"
            onRetry={() => void savedPapersQuery.refetch()}
            state={savedPapersState}
          />
          {savedPapersState.status === "ready" ? (
            savedPapersState.items.length === 0 ? (
              <p className="rw-overview-empty-copy">No papers saved yet. Discover research and keep the most useful references in this Space.</p>
            ) : (
              <ol className="rw-overview-source-list">
                {savedPapersState.items.slice(0, 3).map((savedPaper) => (
                  <li key={savedPaper.paper.id}>
                    <Link to={`/research/papers/${savedPaper.paper.id}`}>{savedPaper.paper.title}</Link>
                    <span>Saved {formatResearchDate(savedPaper.savedAt)}</span>
                  </li>
                ))}
              </ol>
            )
          ) : null}
          <Link className="rw-overview-section__link" to={`/spaces/${space.id}/saved-papers`}>View Saved Papers<ArrowRight aria-hidden="true" size={15} /></Link>
        </section>

        <section className="rw-overview-section" aria-labelledby="overview-knowledge-heading">
          <header>
            <h2 id="overview-knowledge-heading">Documents</h2>
            {documentsState.status === "ready" && firstDocumentPage ? (
              <span>{getOverviewDocumentCountLabel({ count: documentsState.items.length, nextCursor: firstDocumentPage.nextCursor })}</span>
            ) : null}
          </header>
          <SupportingQueryState
            label="Knowledge sources"
            onRetry={() => void documentsQuery.refetch()}
            state={documentsState}
          />
          {documentsState.status === "ready" ? (
            documentsAreEmpty ? (
              <p className="rw-overview-empty-copy">No documents yet. Upload a source in Knowledge to begin indexing grounded evidence.</p>
            ) : documentsState.items.length === 0 ? (
              <p className="rw-overview-empty-copy">No documents are shown in this loaded page. More source records are available.</p>
            ) : (
              <ol className="rw-overview-source-list">
                {documentsState.items.slice(0, 3).map((document) => (
                  <li key={document.id}>
                    <span className="rw-overview-source-list__title">{document.originalFilename}</span>
                    <span>{getDocumentStatusPresentation(document).primary}</span>
                  </li>
                ))}
              </ol>
            )
          ) : null}
          <Link className="rw-overview-section__link" to={`/spaces/${space.id}/knowledge`}>Continue in Knowledge<ArrowRight aria-hidden="true" size={15} /></Link>
        </section>
      </div>

      <section className="rw-overview-collaboration" aria-labelledby="overview-collaboration-heading">
        <div>
          <p className="rw-context-label">Collaboration</p>
          <h2 id="overview-collaboration-heading">Work with the people in this Space.</h2>
          {membersState.status === "ready" ? (
            <p>{membersState.items.length} {membersState.items.length === 1 ? "member has" : "members have"} durable access. Presence remains available in Chat and Members.</p>
          ) : null}
          <SupportingQueryState
            label="Members"
            onRetry={() => void membersQuery.refetch()}
            state={membersState}
          />
        </div>
        <div className="rw-action-group">
          <Button asChild variant="secondary"><Link to={`/spaces/${space.id}/members`}><UsersRound aria-hidden="true" size={16} />View Members</Link></Button>
          <Button asChild variant="secondary"><Link to={`/spaces/${space.id}/chat`}><MessageSquare aria-hidden="true" size={16} />Open Chat</Link></Button>
        </div>
      </section>

      <section className="rw-overview-details" aria-labelledby="space-details-heading">
        <SectionHeader
          action={<span className="rw-role-badge">{space.role}</span>}
          className="rw-overview-details__heading"
          headingId="space-details-heading"
          title="Details"
        />
        <dl className="rw-definition-grid">
          <div><dt>Your role</dt><dd>{space.role === "owner" ? "Owner" : "Member"}</dd></div>
          <div><dt>Created</dt><dd><time dateTime={space.createdAt}>{formatResearchDate(space.createdAt)}</time></dd></div>
          <div><dt>Last updated</dt><dd><time dateTime={space.updatedAt}>{formatResearchDate(space.updatedAt)}</time></dd></div>
          <div><dt>Space ID</dt><dd className="rw-mono">{space.id}</dd></div>
        </dl>
      </section>
    </div>
  );
}
