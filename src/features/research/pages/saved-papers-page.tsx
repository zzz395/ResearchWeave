import { useMutation, useQuery } from "@tanstack/react-query";
import { BookmarkX } from "lucide-react";
import { Link } from "react-router-dom";

import type { SavedPaper } from "../../../../shared/contracts/research";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useAuth } from "../../auth/auth-state";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { formatResearchDate } from "../../spaces/format-research-date";
import { researchQueryKeys } from "../api/query-keys";
import { listSavedPapers, removeSavedPaper } from "../api/research";
import { ExternalPaperLink, PaperSummary } from "../components/paper-presentation";

export function Component() {
  const space = useSpaceLayout();
  const { user } = useAuth();
  const queryKey = researchQueryKeys.savedPapers(space.id);
  const savedPapersQuery = useQuery({
    queryKey,
    queryFn: () => listSavedPapers(space.id),
  });
  const removeMutation = useMutation({
    mutationFn: (paperId: string) => removeSavedPaper(space.id, paperId),
  });

  async function handleRemove(savedPaper: SavedPaper) {
    try {
      await removeMutation.mutateAsync(savedPaper.paper.id);
      await queryClient.invalidateQueries({ queryKey, exact: true });
    } catch {
      // Keep the server-backed record visible until a removal succeeds.
    }
  }

  if (savedPapersQuery.isPending) return <PageLoading label="Loading saved papers" />;
  if (savedPapersQuery.error) {
    const error = savedPapersQuery.error instanceof ApiClientError ? savedPapersQuery.error : null;
    return (
      <div className="rw-space-tab-panel">
        <ErrorPanel
          message={error?.message ?? "Saved papers could not be loaded."}
          onRetry={() => void savedPapersQuery.refetch()}
          requestId={error?.requestId}
          title="Saved papers could not be loaded"
        />
      </div>
    );
  }

  const removeError = removeMutation.error instanceof ApiClientError ? removeMutation.error : null;

  return (
    <section className="rw-space-tab-panel rw-saved-papers">
      <div className="rw-saved-papers__heading">
        <div><p className="rw-page-kicker">Space library</p><h2>Saved papers</h2></div>
        <span>{savedPapersQuery.data.length.toString().padStart(2, "0")}</span>
      </div>
      {removeError ? (
        <Alert>
          <strong>{removeError.status === 403 ? "You cannot remove this paper." : "Paper could not be removed."}</strong>
          <span>{removeError.message}</span>
        </Alert>
      ) : null}
      {savedPapersQuery.data.length === 0 ? (
        <div className="rw-saved-papers__empty">
          <p className="rw-page-kicker">Nothing saved yet</p>
          <h3>Build a focused reading list for this Space.</h3>
          <p>Discover papers in Research, then save the most useful records here.</p>
          <Button asChild><Link to="/research">Search Research</Link></Button>
        </div>
      ) : (
        <div className="rw-paper-list">
          {savedPapersQuery.data.map((savedPaper) => {
            const canRemove = space.role === "owner"
              || (savedPaper.savedByUserId !== null && savedPaper.savedByUserId === user?.id);
            return (
              <PaperSummary
                actions={
                  <>
                    <ExternalPaperLink href={savedPaper.paper.absUrl} />
                    {canRemove ? (
                      <Button
                        disabled={removeMutation.isPending}
                        onClick={() => void handleRemove(savedPaper)}
                        variant="danger"
                      ><BookmarkX aria-hidden="true" size={16} />Remove</Button>
                    ) : null}
                  </>
                }
                eyebrow={
                  <span>Saved {formatResearchDate(savedPaper.savedAt)}</span>
                }
                key={savedPaper.paper.id}
                paper={savedPaper.paper}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
