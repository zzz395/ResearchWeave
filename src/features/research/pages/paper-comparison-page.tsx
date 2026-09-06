import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Info } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { researchQueryKeys } from "../api/query-keys";
import { listSavedPapers } from "../api/research";
import { compareSavedPapers } from "../api/paper-comparison";
import { PaperComparisonResult } from "../components/paper-comparison-result";
import { PaperComparisonSelection } from "../components/paper-comparison-selection";
import {
  mapPaperComparisonError,
  shouldRetryPaperComparisonSavedPapers,
} from "../paper-comparison-errors";
import {
  canSubmitPaperComparison,
  createPaperComparisonMutationOwnership,
  createPaperComparisonSearchParams,
  getPaperComparisonMutationView,
  parsePaperComparisonSearchParams,
  reconcilePaperComparisonPaperIds,
  togglePaperComparisonPaperId,
} from "../paper-comparison-state";

const SOURCE_BASIS_DESCRIPTION =
  "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.";

interface PaperComparisonLocationState {
  paperComparisonNotice?: string;
}

export function PaperComparisonNestedError({
  title,
  message,
  requestId,
  onRetry,
}: {
  title: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="rw-paper-comparison-inline-error" role="alert">
      <AlertCircle aria-hidden="true" size={20} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
        {requestId ? <p className="rw-request-id">Request ID: {requestId}</p> : null}
        {onRetry ? (
          <Button onClick={onRetry} type="button" variant="secondary">
            Try again
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function Component() {
  const space = useSpaceLayout();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const locationState = location.state as PaperComparisonLocationState | null;
  const selectionNotice = typeof locationState?.paperComparisonNotice === "string"
    ? locationState.paperComparisonNotice
    : "";
  const rawSearch = searchParams.toString();
  const urlSelection = useMemo(
    () => parsePaperComparisonSearchParams(new URLSearchParams(rawSearch)),
    [rawSearch],
  );
  const savedPapersQuery = useQuery({
    queryKey: researchQueryKeys.savedPapers(space.id),
    queryFn: () => listSavedPapers(space.id),
    retry: shouldRetryPaperComparisonSavedPapers,
  });
  const comparisonMutation = useMutation({
    mutationFn: ({ spaceId, paperIds }: ReturnType<typeof createPaperComparisonMutationOwnership>) => (
      compareSavedPapers(spaceId, { paperIds })
    ),
    retry: false,
  });

  const availablePaperIds = savedPapersQuery.data?.map(({ paper }) => paper.id);
  const reconciledSelection = availablePaperIds
    ? reconcilePaperComparisonPaperIds(urlSelection.paperIds, availablePaperIds)
    : { paperIds: urlSelection.paperIds, changed: false };
  const selectedPaperIds = reconciledSelection.paperIds;
  const comparisonErrorCode = comparisonMutation.error instanceof ApiClientError
    ? comparisonMutation.error.code
    : undefined;
  const mutationView = getPaperComparisonMutationView({
    current: { spaceId: space.id, paperIds: selectedPaperIds },
    submitted: comparisonMutation.variables,
    status: comparisonMutation.status,
    errorCode: comparisonErrorCode,
  });
  const mutationIsPending = mutationView === "pending";
  const mutationHasResult = mutationView === "result";
  const mutationHasError = mutationView === "error" || mutationView === "space_unavailable";
  const comparisonError = mutationHasError
    ? mapPaperComparisonError(comparisonMutation.error)
    : null;
  const savedPapersError = savedPapersQuery.error instanceof ApiClientError
    ? savedPapersQuery.error
    : null;
  const savedPapersSpaceUnavailable = savedPapersError?.code === "space_not_found";
  const canonicalSearch = createPaperComparisonSearchParams(selectedPaperIds).toString();

  useEffect(() => {
    if (!savedPapersQuery.isPending) pageHeadingRef.current?.focus();
  }, [savedPapersQuery.isPending]);

  useEffect(() => {
    if (!availablePaperIds || rawSearch === canonicalSearch) return;
    const paperComparisonNotice = reconciledSelection.changed
      ? "Some selected papers are unavailable in this Space and were removed."
      : "The paper selection was adjusted to valid, unique saved papers.";
    setSearchParams(createPaperComparisonSearchParams(selectedPaperIds), {
      replace: true,
      state: { paperComparisonNotice },
    });
  }, [
    availablePaperIds,
    canonicalSearch,
    rawSearch,
    reconciledSelection.changed,
    selectedPaperIds,
    setSearchParams,
  ]);

  function handleToggle(paperId: string) {
    if (mutationIsPending) return;
    const nextPaperIds = togglePaperComparisonPaperId(selectedPaperIds, paperId);
    if (nextPaperIds === selectedPaperIds) return;
    setSearchParams(createPaperComparisonSearchParams(nextPaperIds), { state: null });
  }

  function handleCompare() {
    if (mutationIsPending || !canSubmitPaperComparison(selectedPaperIds)) return;
    if (selectionNotice) {
      setSearchParams(createPaperComparisonSearchParams(selectedPaperIds), {
        replace: true,
        state: null,
      });
    }
    comparisonMutation.reset();
    comparisonMutation.mutate(
      createPaperComparisonMutationOwnership(space.id, selectedPaperIds),
    );
  }

  function handleRefreshSelection() {
    void savedPapersQuery.refetch();
  }

  return (
    <section
      aria-labelledby="paper-comparison-heading"
      className="rw-space-tab-panel rw-paper-comparison-page"
    >
      <Button asChild className="rw-paper-comparison-back" variant="ghost">
        <Link to={`/spaces/${space.id}/saved-papers`}>
          <ArrowLeft aria-hidden="true" size={16} />Back to Saved Papers
        </Link>
      </Button>

      <header className="rw-paper-comparison-header">
        <p className="rw-page-kicker">Saved papers workflow</p>
        <h2 id="paper-comparison-heading" ref={pageHeadingRef} tabIndex={-1}>
          Compare saved papers
        </h2>
        <p>Select two to four papers from this Space, then generate a bounded comparison.</p>
      </header>

      {!mutationHasResult
        && comparisonError?.surface !== "page"
        && !savedPapersSpaceUnavailable ? (
        <aside
          aria-labelledby="paper-comparison-scope-heading"
          className="rw-paper-comparison-scope"
        >
          <Info aria-hidden="true" size={19} />
          <div>
            <h3 id="paper-comparison-scope-heading">Abstract-based comparison</h3>
            <p>{SOURCE_BASIS_DESCRIPTION}</p>
            <small>Generated results are temporary and are not saved.</small>
          </div>
        </aside>
      ) : null}

      {selectionNotice
        && !savedPapersSpaceUnavailable
        && comparisonError?.surface !== "page" ? (
        <p
          aria-atomic="true"
          aria-live="polite"
          className="rw-paper-comparison-notice"
          role="status"
        >
          {selectionNotice}
        </p>
      ) : null}

      {savedPapersQuery.isPending ? (
        <PageLoading label="Loading saved papers for comparison" />
      ) : savedPapersSpaceUnavailable ? (
        <div className="rw-paper-comparison-page-error">
          <PaperComparisonNestedError
            message="This space is no longer available or your access may have changed."
            requestId={savedPapersError.requestId}
            title="Space is unavailable"
          />
          <Button asChild variant="secondary"><Link to="/spaces">Back to Spaces</Link></Button>
        </div>
      ) : savedPapersQuery.error ? (
        <PaperComparisonNestedError
          message="Saved papers could not be loaded for this comparison."
          onRetry={() => void savedPapersQuery.refetch()}
          requestId={savedPapersError?.requestId}
          title="Saved papers could not be loaded"
        />
      ) : comparisonError?.surface === "page" ? (
        <div className="rw-paper-comparison-page-error">
          <PaperComparisonNestedError
            message={comparisonError.message}
            requestId={comparisonError.requestId}
            title={comparisonError.title}
          />
          <Button asChild variant="secondary"><Link to="/spaces">Back to Spaces</Link></Button>
        </div>
      ) : (
        <>
          <PaperComparisonSelection
            hasResult={mutationHasResult}
            isPending={mutationIsPending}
            onSubmit={handleCompare}
            onToggle={handleToggle}
            savedPapers={savedPapersQuery.data ?? []}
            selectedPaperIds={selectedPaperIds}
          />

          {comparisonError?.surface === "selection" ? (
            <Alert>
              <strong>{comparisonError.title}</strong>
              <span>{comparisonError.message}</span>
              {comparisonError.requestId ? (
                <small className="rw-request-id">Request ID: {comparisonError.requestId}</small>
              ) : null}
              {comparisonError.action === "refresh_selection" ? (
                <Button onClick={handleRefreshSelection} type="button" variant="secondary">
                  Refresh Saved Papers
                </Button>
              ) : null}
            </Alert>
          ) : null}

          {mutationIsPending ? (
            <div
              aria-atomic="true"
              aria-busy="true"
              aria-live="polite"
              className="rw-paper-comparison-pending"
              role="status"
            >
              <LoadingLabel>Generating an abstract-based comparison…</LoadingLabel>
              <div aria-hidden="true" className="rw-paper-comparison-pending__skeletons">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {comparisonError?.surface === "result" ? (
            <div className="rw-paper-comparison-result-error">
              <PaperComparisonNestedError
                message={comparisonError.message}
                onRetry={comparisonError.action === "retry" ? handleCompare : undefined}
                requestId={comparisonError.requestId}
                title={comparisonError.title}
              />
            </div>
          ) : null}

          {mutationHasResult && comparisonMutation.data ? (
            <PaperComparisonResult result={comparisonMutation.data} />
          ) : null}
        </>
      )}
    </section>
  );
}
