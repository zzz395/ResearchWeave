import { useEffect, useRef } from "react";

import type { PaperComparisonResponse } from "../../../../shared/contracts/paper-comparison";
import { formatResearchDate } from "../../spaces/format-research-date";
import { AuthorLine, CategoryList, ExternalPaperLink } from "./paper-presentation";

const NOT_STATED = "Not stated in the available metadata or abstract.";
const PAPER_LABELS = ["Paper A", "Paper B", "Paper C", "Paper D"] as const;

function paperLabel(index: number) {
  return PAPER_LABELS[index] ?? `Paper ${index + 1}`;
}

function observationFor(
  dimension: PaperComparisonResponse["comparison"]["dimensions"][number],
  paperId: string,
) {
  return dimension.observations.find((observation) => observation.paperId === paperId)?.statement
    ?? NOT_STATED;
}

export function PaperComparisonResult({ result }: { result: PaperComparisonResponse }) {
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    resultHeadingRef.current?.focus();
  }, [result]);

  return (
    <article
      aria-labelledby="paper-comparison-result-heading"
      className="rw-paper-comparison-result"
    >
      <p
        aria-atomic="true"
        aria-live="polite"
        className="rw-visually-hidden"
        role="status"
      >
        Comparison ready
      </p>
      <h3 id="paper-comparison-result-heading" ref={resultHeadingRef} tabIndex={-1}>
        Comparison result
      </h3>

      <section
        aria-labelledby="paper-comparison-source-heading"
        className="rw-paper-comparison-result__source"
      >
        <h4 id="paper-comparison-source-heading">{result.sourceBasis.label}</h4>
        <p>{result.sourceBasis.description}</p>
      </section>

      <section
        aria-labelledby="paper-comparison-papers-heading"
        className="rw-paper-comparison-result__papers"
      >
        <h4 id="paper-comparison-papers-heading">Compared papers</h4>
        <ol className="rw-paper-comparison-result__paper-list">
          {result.papers.map((paper, index) => (
            <li key={paper.id}>
              <article className="rw-paper-comparison-result__paper">
                <p className="rw-paper-comparison-result__paper-label">{paperLabel(index)}</p>
                <h5>{paper.title}</h5>
                <p className="rw-paper-comparison-result__authors">
                  <AuthorLine authors={paper.authors} />
                </p>
                <p className="rw-paper-comparison-result__arxiv-id">
                  arXiv {paper.versionedArxivId}
                </p>
                <p className="rw-visually-hidden">
                  Primary category: {paper.primaryCategory}.
                </p>
                <CategoryList
                  categories={paper.categories}
                  primaryCategory={paper.primaryCategory}
                />
                <div className="rw-paper-comparison-result__paper-action">
                  <ExternalPaperLink href={paper.absUrl} label="View abstract record" />
                </div>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="paper-comparison-overview-heading"
        className="rw-paper-comparison-result__overview"
      >
        <h4 id="paper-comparison-overview-heading">Overview</h4>
        <p>{result.comparison.overview}</p>
      </section>

      <section
        aria-labelledby="paper-comparison-similarities-heading"
        className="rw-paper-comparison-result__similarities"
      >
        <h4 id="paper-comparison-similarities-heading">Similarities</h4>
        {result.comparison.similarities.length > 0 ? (
          <ul>
            {result.comparison.similarities.map((similarity, index) => (
              <li key={`${index}-${similarity}`}>{similarity}</li>
            ))}
          </ul>
        ) : (
          <p>No shared similarities were supported by the available metadata and abstracts.</p>
        )}
      </section>

      <section
        aria-labelledby="paper-comparison-dimensions-heading"
        className="rw-paper-comparison-result__dimensions"
      >
        <h4 id="paper-comparison-dimensions-heading">Dimensions</h4>
        {result.comparison.dimensions.length > 0 ? (
          <>
            <div className="rw-paper-comparison-result__table-view">
              <table>
                <caption>Comparison dimensions across selected papers</caption>
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    {result.papers.map((paper, index) => (
                      <th key={paper.id} scope="col">
                        <span>{paperLabel(index)}</span>
                        <small>{paper.title}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.comparison.dimensions.map((dimension, dimensionIndex) => (
                    <tr key={`${dimensionIndex}-${dimension.label}`}>
                      <th scope="row">{dimension.label}</th>
                      {result.papers.map((paper) => (
                        <td key={paper.id}>{observationFor(dimension, paper.id)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rw-paper-comparison-result__compact-view">
              {result.comparison.dimensions.map((dimension, dimensionIndex) => {
                const headingId = `paper-comparison-dimension-${dimensionIndex}`;
                return (
                  <section
                    aria-labelledby={headingId}
                    className="rw-paper-comparison-result__dimension"
                    key={`${dimensionIndex}-${dimension.label}`}
                  >
                    <h5 id={headingId}>{dimension.label}</h5>
                    <dl className="rw-paper-comparison-result__observations">
                      {result.papers.map((paper, paperIndex) => (
                        <div
                          className="rw-paper-comparison-result__observation"
                          key={paper.id}
                        >
                          <dt>
                            <span>{paperLabel(paperIndex)}</span>
                            <small>{paper.title}</small>
                          </dt>
                          <dd>{observationFor(dimension, paper.id)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <p>No comparison dimensions were supported by the available metadata and abstracts.</p>
        )}
      </section>

      <footer className="rw-paper-comparison-result__generation">
        <p>
          Generated <time dateTime={result.generation.generatedAt}>
            {formatResearchDate(result.generation.generatedAt)}
          </time>
        </p>
        <p>This result is not saved.</p>
      </footer>
    </article>
  );
}
