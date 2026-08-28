import {
  researchSearchQuerySchema,
  type ResearchSearchQuery,
} from "../../../shared/contracts/research";

export const ARXIV_QUERY_ENDPOINT = "https://export.arxiv.org/api/query";

const sortBy = {
  relevance: "relevance",
  submitted: "submittedDate",
  updated: "lastUpdatedDate",
} as const satisfies Record<ResearchSearchQuery["sort"], string>;

function encodeArxivLiteralTerm(value: string) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function buildLiteralSearchQuery(value: string) {
  return value
    .split(" ")
    .map((term) => `all:"${encodeArxivLiteralTerm(term)}"`)
    .join(" AND ");
}

export function parseResearchSearchQuery(input: unknown): ResearchSearchQuery {
  return researchSearchQuerySchema.parse(input);
}

export function buildArxivSearchUrl(input: ResearchSearchQuery) {
  const url = new URL(ARXIV_QUERY_ENDPOINT);
  url.searchParams.set("search_query", buildLiteralSearchQuery(input.q));
  url.searchParams.set("start", String((input.page - 1) * input.pageSize));
  url.searchParams.set("max_results", String(input.pageSize));
  url.searchParams.set("sortBy", sortBy[input.sort]);
  url.searchParams.set("sortOrder", "descending");
  return url;
}

export function createArxivCacheKey(input: ResearchSearchQuery) {
  return JSON.stringify([input.q, input.page, input.pageSize, input.sort]);
}
