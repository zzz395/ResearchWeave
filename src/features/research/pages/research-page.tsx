import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { researchSearchQuerySchema } from "../../../../shared/contracts/research";
import { Button } from "../../../components/ui/button";
import { EmptyState, ErrorPanel, QueryState, SectionHeader } from "../../../components/ui/feedback";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { researchQueryKeys } from "../api/query-keys";
import { searchResearchPapers } from "../api/research";
import { PaperSummary } from "../components/paper-presentation";
import { SavePaperDialog } from "../components/save-paper-dialog";
import { getResearchError } from "../research-errors";
import {
  createResearchSearchParams,
  getResearchPaginationScrollBehavior,
  isValidSubmittedQuery,
  parseResearchSearchParams,
  type ResearchSort,
} from "../research-search-state";

const PAGE_SIZE = 10;

function ResearchSearchForm({
  initialQuery,
  sort,
  onSearch,
  onSort,
}: {
  initialQuery: string;
  sort: ResearchSort;
  onSearch: (query: string) => void;
  onSort: (sort: ResearchSort) => void;
}) {
  const [draft, setDraft] = useState(initialQuery);
  const [fieldError, setFieldError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = researchSearchQuerySchema.safeParse({
      q: draft,
      page: 1,
      pageSize: PAGE_SIZE,
      sort,
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a valid search query.");
      return;
    }
    setFieldError("");
    onSearch(parsed.data.q);
  }

  return (
    <form className="rw-research-search" noValidate onSubmit={handleSubmit}>
      <div className="rw-field rw-research-search__query">
        <div className="rw-field__label-row">
          <label htmlFor="research-query">Search papers</label>
          <span>2–200 characters</span>
        </div>
        <input
          aria-describedby={fieldError ? "research-query-error" : undefined}
          aria-invalid={Boolean(fieldError)}
          className="rw-input"
          id="research-query"
          onChange={(event) => {
            setDraft(event.target.value);
            if (fieldError) setFieldError("");
          }}
          placeholder="e.g. retrieval augmented generation"
          value={draft}
        />
        {fieldError ? <p className="rw-field__error" id="research-query-error" role="alert">{fieldError}</p> : null}
      </div>
      <div className="rw-field">
        <div className="rw-field__label-row"><label htmlFor="research-sort">Sort by</label></div>
        <select
          className="rw-input rw-select"
          id="research-sort"
          onChange={(event) => onSort(event.target.value as ResearchSort)}
          value={sort}
        >
          <option value="relevance">Relevance</option>
          <option value="submitted">Submitted date</option>
          <option value="updated">Updated date</option>
        </select>
      </div>
      <Button className="rw-research-search__submit" type="submit">
        <Search aria-hidden="true" size={17} />Search
      </Button>
    </form>
  );
}

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = parseResearchSearchParams(searchParams);
  const hasSubmittedQuery = isValidSubmittedQuery(urlState.q);
  const searchQuery = useQuery({
    queryKey: researchQueryKeys.search(urlState),
    queryFn: () => searchResearchPapers({ ...urlState, pageSize: PAGE_SIZE }),
    enabled: hasSubmittedQuery,
  });

  function handleSort(sort: ResearchSort) {
    setSearchParams(createResearchSearchParams({ ...urlState, page: 1, sort }));
  }

  function handlePage(page: number) {
    setSearchParams(createResearchSearchParams({ ...urlState, page }));
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({
      top: 0,
      behavior: getResearchPaginationScrollBehavior(prefersReducedMotion),
    });
  }

  const results = searchQuery.data;
  const hasNextPage = results
    ? results.startIndex + results.itemsPerPage < results.totalResults
    : false;
  const searchError = getResearchError(searchQuery.error);

  return (
    <ContentSection>
      <PageHeader
        description="Search arXiv, inspect durable paper records, and save useful work into your Research Spaces."
        title="Research"
      />
      <ResearchSearchForm
        initialQuery={urlState.q}
        key={urlState.q}
        onSearch={(q) => setSearchParams(createResearchSearchParams({ q, page: 1, sort: urlState.sort }))}
        onSort={handleSort}
        sort={urlState.sort}
      />

      {!hasSubmittedQuery ? (
        <section className="rw-research-intro">
          <div>
            <h2>Find the literature that moves your work forward.</h2>
            <p>Search by research topic, paper title, author name, or keywords. Results are fetched only when you submit.</p>
          </div>
        </section>
      ) : null}

      {hasSubmittedQuery && searchQuery.isPending ? (
        <QueryState className="rw-research-loading" label="Searching arXiv" status="loading" />
      ) : null}

      {hasSubmittedQuery && searchQuery.error ? (
        <ErrorPanel
          message={searchError.message}
          onRetry={() => void searchQuery.refetch()}
          requestId={searchError.requestId}
          title={searchError.title}
        />
      ) : null}

      {results && results.papers.length === 0 ? (
        <EmptyState className="rw-research-empty">
          <h2>No papers found for “{urlState.q}”</h2>
          <p>Try broader terms, another author name, or a different arXiv query.</p>
        </EmptyState>
      ) : null}

      {results && results.papers.length > 0 ? (
        <section className="rw-research-results" aria-label="Research results">
          <SectionHeader
            className="rw-research-results__heading"
            count={`${results.totalResults.toLocaleString()} papers`}
            title={urlState.q}
          />
          <div className="rw-paper-list">
            {results.papers.map((paper) => (
              <PaperSummary
                actions={<SavePaperDialog paper={paper} />}
                key={paper.id}
                paper={paper}
              />
            ))}
          </div>
          <nav aria-label="Research result pages" className="rw-research-pagination">
            <Button
              disabled={urlState.page <= 1}
              onClick={() => handlePage(urlState.page - 1)}
              variant="secondary"
            ><ArrowLeft aria-hidden="true" size={16} />Previous</Button>
            <span>Page {urlState.page}</span>
            <Button
              disabled={!hasNextPage}
              onClick={() => handlePage(urlState.page + 1)}
              variant="secondary"
            >Next<ArrowRight aria-hidden="true" size={16} /></Button>
          </nav>
        </section>
      ) : null}
    </ContentSection>
  );
}
