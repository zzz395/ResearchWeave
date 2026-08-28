import type { ResearchSearchQuery } from "../../../shared/contracts/research";

export type ResearchSort = ResearchSearchQuery["sort"];

export interface ResearchUrlState {
  q: string;
  page: number;
  sort: ResearchSort;
}

const supportedSorts = new Set<ResearchSort>(["relevance", "submitted", "updated"]);

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function isValidSubmittedQuery(q: string) {
  const normalized = normalizeQuery(q);
  return normalized.length >= 2 && normalized.length <= 200;
}

export function parseResearchSearchParams(params: URLSearchParams): ResearchUrlState {
  const q = normalizeQuery(params.get("q") ?? "");
  const pageValue = params.get("page") ?? "";
  const page = /^\d+$/u.test(pageValue) && Number(pageValue) > 0 ? Number(pageValue) : 1;
  const sortValue = params.get("sort") as ResearchSort | null;
  return {
    q,
    page,
    sort: sortValue && supportedSorts.has(sortValue) ? sortValue : "relevance",
  };
}

export function createResearchSearchParams(state: ResearchUrlState) {
  return new URLSearchParams({
    q: normalizeQuery(state.q),
    page: String(state.page),
    sort: state.sort,
  });
}
