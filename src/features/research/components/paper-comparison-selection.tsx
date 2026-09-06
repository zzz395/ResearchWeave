import { GitCompareArrows } from "lucide-react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  PAPER_COMPARISON_MAX_PAPERS,
  PAPER_COMPARISON_MIN_PAPERS,
} from "../../../../shared/contracts/paper-comparison";
import type { SavedPaper } from "../../../../shared/contracts/research";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/feedback";
import { AuthorLine } from "./paper-presentation";

const REQUIREMENT_ID = "paper-comparison-selection-requirement";

export interface PaperComparisonSelectionProps {
  savedPapers: readonly SavedPaper[];
  selectedPaperIds: readonly string[];
  isPending: boolean;
  hasResult: boolean;
  onToggle: (paperId: string) => void;
  onSubmit: () => void;
}

export function PaperComparisonSelection({
  savedPapers,
  selectedPaperIds,
  isPending,
  hasResult,
  onToggle,
  onSubmit,
}: PaperComparisonSelectionProps) {
  const selectedIds = new Set(selectedPaperIds);
  const selectedCount = selectedPaperIds.length;
  const hasMaximumSelection = selectedCount >= PAPER_COMPARISON_MAX_PAPERS;
  const canSubmit = selectedCount >= PAPER_COMPARISON_MIN_PAPERS
    && selectedCount <= PAPER_COMPARISON_MAX_PAPERS;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !canSubmit) return;
    onSubmit();
  }

  if (savedPapers.length === 0) {
    return (
      <EmptyState className="rw-paper-comparison-selection__empty">
        <h3>No saved papers to compare yet.</h3>
        <p>Save at least two papers to this Space, then return here to compare their abstracts.</p>
        <Button asChild><Link to="/research">Search Research</Link></Button>
      </EmptyState>
    );
  }

  const submitLabel = isPending
    ? "Comparing…"
    : hasResult
      ? "Compare again"
      : "Compare selected papers";

  return (
    <form
      aria-busy={isPending}
      className="rw-paper-comparison-selection"
      onSubmit={handleSubmit}
    >
      <fieldset className="rw-paper-comparison-selection__fieldset" disabled={isPending}>
        <legend>Choose saved papers</legend>
        <p className="rw-paper-comparison-selection__guidance">
          Select two to four papers. The order you select them determines the Paper A–D labels in the result.
        </p>
        <div className="rw-paper-comparison-selection__list">
          {savedPapers.map(({ paper }) => {
            const isSelected = selectedIds.has(paper.id);
            const isDisabled = isPending || (hasMaximumSelection && !isSelected);

            return (
              <label
                className={[
                  "rw-paper-comparison-selection__option",
                  isSelected ? "is-selected" : "",
                  isDisabled ? "is-disabled" : "",
                ].filter(Boolean).join(" ")}
                key={paper.id}
              >
                <input
                  checked={isSelected}
                  disabled={isDisabled}
                  name="paper"
                  onChange={() => onToggle(paper.id)}
                  type="checkbox"
                  value={paper.id}
                />
                <span className="rw-paper-comparison-selection__paper">
                  <strong>{paper.title}</strong>
                  <span className="rw-paper-comparison-selection__authors">
                    <AuthorLine authors={paper.authors} />
                  </span>
                  <span className="rw-paper-comparison-selection__identity">
                    <span>arXiv {paper.versionedArxivId}</span>
                    <span
                      aria-label={`Paper categories. Primary category: ${paper.primaryCategory}. All categories: ${paper.categories.join(", ")}.`}
                      className="rw-paper-categories"
                    >
                      {paper.categories.map((category) => (
                        <span
                          className={category === paper.primaryCategory ? "is-primary" : ""}
                          key={category}
                        >
                          {category}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="rw-paper-comparison-selection__footer">
        <div>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="rw-paper-comparison-selection__count"
            role="status"
          >
            {selectedCount} of {PAPER_COMPARISON_MAX_PAPERS} selected
          </p>
          <p id={REQUIREMENT_ID} className="rw-paper-comparison-selection__requirement">
            {selectedCount < PAPER_COMPARISON_MIN_PAPERS
              ? savedPapers.length === 1
                ? "Save at least one more paper to create a comparison."
                : "Select at least two papers to create a comparison."
              : hasMaximumSelection
                ? "Maximum of four papers selected."
                : `You can select ${PAPER_COMPARISON_MAX_PAPERS - selectedCount} more.`}
          </p>
        </div>
        <Button
          aria-describedby={!canSubmit ? REQUIREMENT_ID : undefined}
          disabled={isPending || !canSubmit}
          type="submit"
        >
          <GitCompareArrows aria-hidden="true" size={17} />
          {submitLabel}
        </Button>
      </div>

    </form>
  );
}
