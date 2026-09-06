import { z } from "zod";

import {
  PAPER_COMPARISON_MAX_PAPERS,
  paperComparisonRequestSchema,
} from "../../../shared/contracts/paper-comparison";

export interface ParsedPaperComparisonSearchParams {
  paperIds: string[];
  wasNormalized: boolean;
}

export interface ReconciledPaperComparisonPaperIds {
  paperIds: string[];
  changed: boolean;
}

export interface PaperComparisonMutationOwnership {
  spaceId: string;
  paperIds: string[];
}

export type PaperComparisonMutationStatus = "idle" | "pending" | "success" | "error";
export type PaperComparisonMutationView =
  | "idle"
  | "pending"
  | "result"
  | "error"
  | "space_unavailable";

export interface PaperComparisonMutationViewInput {
  current: Pick<PaperComparisonMutationOwnership, "spaceId" | "paperIds">;
  submitted?: PaperComparisonMutationOwnership;
  status: PaperComparisonMutationStatus;
  errorCode?: string;
}

const paperIdSchema = z.string().uuid();

function normalizePaperIds(paperIds: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const paperId of paperIds) {
    if (!paperIdSchema.safeParse(paperId).success || seen.has(paperId)) continue;
    seen.add(paperId);
    normalized.push(paperId);
    if (normalized.length === PAPER_COMPARISON_MAX_PAPERS) break;
  }

  return normalized;
}

function paperIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((paperId, index) => paperId === right[index]);
}

export function getPaperComparisonPath(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/saved-papers/compare`;
}

export function createPaperComparisonSearchParams(
  paperIds: readonly string[],
): URLSearchParams {
  const params = new URLSearchParams();
  for (const paperId of normalizePaperIds(paperIds)) params.append("paper", paperId);
  return params;
}

export function parsePaperComparisonSearchParams(
  params: URLSearchParams,
): ParsedPaperComparisonSearchParams {
  const paperIds = normalizePaperIds(params.getAll("paper"));
  const canonicalParams = createPaperComparisonSearchParams(paperIds);

  return {
    paperIds,
    wasNormalized: params.toString() !== canonicalParams.toString(),
  };
}

export function reconcilePaperComparisonPaperIds(
  paperIds: string[],
  availablePaperIds: readonly string[],
): ReconciledPaperComparisonPaperIds {
  const normalized = normalizePaperIds(paperIds);
  const available = new Set(availablePaperIds);
  const reconciled = normalized.filter((paperId) => available.has(paperId));
  const changed = !paperIdsEqual(paperIds, reconciled);

  return {
    paperIds: changed ? reconciled : paperIds,
    changed,
  };
}

export function togglePaperComparisonPaperId(
  paperIds: string[],
  paperId: string,
): string[] {
  const normalized = normalizePaperIds(paperIds);
  const inputWasNormalized = paperIdsEqual(paperIds, normalized);
  if (!paperIdSchema.safeParse(paperId).success) {
    return inputWasNormalized ? paperIds : normalized;
  }
  if (normalized.includes(paperId)) {
    return normalized.filter((selectedPaperId) => selectedPaperId !== paperId);
  }
  if (normalized.length === PAPER_COMPARISON_MAX_PAPERS) {
    return inputWasNormalized ? paperIds : normalized;
  }
  return [...normalized, paperId];
}

export function canSubmitPaperComparison(paperIds: readonly string[]): boolean {
  return paperComparisonRequestSchema.safeParse({ paperIds }).success;
}

export function createPaperComparisonMutationOwnership(
  spaceId: string,
  paperIds: readonly string[],
): PaperComparisonMutationOwnership {
  return { spaceId, paperIds: [...paperIds] };
}

export function getPaperComparisonMutationView({
  current,
  submitted,
  status,
  errorCode,
}: PaperComparisonMutationViewInput): PaperComparisonMutationView {
  if (!submitted || status === "idle" || submitted.spaceId !== current.spaceId) return "idle";

  if (status === "error" && errorCode === "space_not_found") {
    return "space_unavailable";
  }

  if (!paperIdsEqual(submitted.paperIds, current.paperIds)) return "idle";

  if (status === "pending") return "pending";
  if (status === "success") return "result";
  return "error";
}

export function getPaperComparisonSelectionFingerprint(
  paperIds: readonly string[],
): string {
  return JSON.stringify(normalizePaperIds(paperIds));
}
