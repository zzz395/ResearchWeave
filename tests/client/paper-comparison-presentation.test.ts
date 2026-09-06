import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  paperComparisonResponseSchema,
  type PaperComparisonResponse,
} from "../../shared/contracts/paper-comparison";
import type { SavedPaper } from "../../shared/contracts/research";
import { PaperComparisonResult } from "../../src/features/research/components/paper-comparison-result";
import { PaperComparisonSelection } from "../../src/features/research/components/paper-comparison-selection";
import { PaperComparisonNestedError } from "../../src/features/research/pages/paper-comparison-page";

const paperIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
] as const;

function savedPaper(index: number): SavedPaper {
  const sequence = index + 1;
  return {
    paper: {
      id: paperIds[index] ?? paperIds[0],
      canonicalArxivId: `2609.0000${sequence}`,
      versionedArxivId: `2609.0000${sequence}v2`,
      version: 2,
      title: `Evidence Paper ${sequence}`,
      abstract: `Stored abstract ${sequence}.`,
      authors: [`Author ${sequence}`, "Shared Author"],
      primaryCategory: "cs.IR",
      categories: ["cs.IR", "cs.AI"],
      publishedAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      fetchedAt: "2026-09-03T08:00:00.000Z",
      absUrl: `https://arxiv.org/abs/2609.0000${sequence}v2`,
      pdfUrl: `https://arxiv.org/pdf/2609.0000${sequence}v2`,
    },
    savedByUserId: null,
    savedAt: "2026-09-04T08:00:00.000Z",
  };
}

const savedPapers = Array.from({ length: 5 }, (_, index) => savedPaper(index));

function renderSelection(overrides: Partial<Parameters<typeof PaperComparisonSelection>[0]> = {}) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: ["/spaces/space-id/saved-papers/compare"] },
    createElement(PaperComparisonSelection, {
      savedPapers,
      selectedPaperIds: [],
      isPending: false,
      hasResult: false,
      onToggle: vi.fn(),
      onSubmit: vi.fn(),
      ...overrides,
    }),
  ));
}

function comparisonResult(overrides: {
  similarities?: string[];
  dimensions?: PaperComparisonResponse["comparison"]["dimensions"];
} = {}): PaperComparisonResponse {
  return paperComparisonResponseSchema.parse({
    sourceBasis: {
      type: "arxiv_metadata_and_abstracts",
      label: "Abstract-based comparison",
      description: "This comparison uses stored arXiv metadata and abstracts only. It does not use or claim access to full text or indexed documents.",
    },
    papers: savedPapers.slice(0, 2).map(({ paper }) => {
      const { fetchedAt, ...comparisonPaper } = paper;
      void fetchedAt;
      return comparisonPaper;
    }),
    comparison: {
      overview: "Both papers test bounded retrieval strategies against shared benchmarks.",
      similarities: overrides.similarities ?? ["Both evaluate retrieval quality."],
      dimensions: overrides.dimensions ?? [
        {
          label: "Evaluation approach",
          observations: [
            { paperId: paperIds[0], statement: "Uses an offline benchmark." },
            { paperId: paperIds[1], statement: null },
          ],
        },
      ],
    },
    generation: {
      model: "provider-model-that-must-remain-hidden",
      promptVersion: "abstract-comparison-v1",
      generatedAt: "2026-09-06T08:00:00.000Z",
    },
  });
}

describe("Paper comparison selection presentation", () => {
  it("shows a focused empty state when no saved papers are available", () => {
    const html = renderSelection({ savedPapers: [] });

    expect(html).toContain("No saved papers to compare yet.");
    expect(html).toContain("Save at least two papers");
    expect(html).toContain('href="/research"');
    expect(html).toContain("Search Research");
  });

  it("uses native grouped controls and explains the one-paper state", () => {
    const html = renderSelection({ savedPapers: savedPapers.slice(0, 1) });

    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend>Choose saved papers</legend>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Evidence Paper 1");
    expect(html).toContain("Author 1, Shared Author");
    expect(html).toContain("arXiv 2609.00001v2");
    expect(html).toContain("cs.IR");
    expect(html).toContain("Primary category: cs.IR. All categories: cs.IR, cs.AI.");
    expect(html).toContain("The order you select them determines the Paper A–D labels");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("0 of 4 selected");
    expect(html).toContain("Save at least one more paper to create a comparison.");
    expect(html).toContain('aria-describedby="paper-comparison-selection-requirement"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });

  it("disables only unchecked options after four selections", () => {
    const html = renderSelection({ selectedPaperIds: paperIds.slice(0, 4) });
    const fifthInput = html.match(/<input[^>]*value="10000000-0000-4000-8000-000000000005"[^>]*>/)?.[0];

    expect(html).toContain("4 of 4 selected");
    expect(html).toContain("Maximum of four papers selected.");
    expect(html.match(/checked=""/g)).toHaveLength(4);
    expect(fifthInput).toContain('disabled=""');
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).toContain("Compare selected papers");
  });

  it("locks selection while a comparison is pending", () => {
    const html = renderSelection({
      selectedPaperIds: paperIds.slice(0, 2),
      isPending: true,
    });

    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(5);
    expect(html).toContain("Comparing…");
  });

  it("labels an explicit resubmission after a result", () => {
    const html = renderSelection({
      selectedPaperIds: paperIds.slice(0, 2),
      hasResult: true,
    });

    expect(html).toContain("Compare again");
  });
});

describe("Paper comparison result presentation", () => {
  it("renders provenance and ordered paper identity without PDF links", () => {
    const html = renderToStaticMarkup(createElement(PaperComparisonResult, {
      result: comparisonResult(),
    }));

    expect(html).toContain("Abstract-based comparison");
    expect(html).toContain("This comparison uses stored arXiv metadata and abstracts only.");
    expect(html.indexOf("Paper A")).toBeLessThan(html.indexOf("Paper B"));
    expect(html).toContain("Evidence Paper 1");
    expect(html).toContain("Author 1, Shared Author");
    expect(html).toContain("arXiv 2609.00001v2");
    expect(html).toContain("Primary category: cs.IR.");
    expect(html).toContain('href="https://arxiv.org/abs/2609.00001v2"');
    expect(html).not.toContain("https://arxiv.org/pdf/");
    expect(html).toContain("View abstract record");
  });

  it("renders overview, similarities, and both semantic dimension layouts", () => {
    const html = renderToStaticMarkup(createElement(PaperComparisonResult, {
      result: comparisonResult(),
    }));

    expect(html).toContain("Both papers test bounded retrieval strategies");
    expect(html).toContain("<ul><li>Both evaluate retrieval quality.</li></ul>");
    expect(html).toContain('<div class="rw-paper-comparison-result__table-view"><table>');
    expect(html).toContain("<caption>Comparison dimensions across selected papers</caption>");
    expect(html).toContain('<th scope="col"><span>Paper A</span><small>Evidence Paper 1</small></th>');
    expect(html).toContain('<th scope="row">Evaluation approach</th>');
    expect(html).toContain('class="rw-paper-comparison-result__compact-view"');
    expect(html).toContain("<dt><span>Paper A</span><small>Evidence Paper 1</small></dt>");
    expect(html).toContain("Uses an offline benchmark.");
    expect(html.match(/Not stated in the available metadata or abstract\./g)).toHaveLength(2);
  });

  it("states legitimate evidence limitations for empty generated lists", () => {
    const html = renderToStaticMarkup(createElement(PaperComparisonResult, {
      result: comparisonResult({ similarities: [], dimensions: [] }),
    }));

    expect(html).toContain(
      "No shared similarities were supported by the available metadata and abstracts.",
    );
    expect(html).toContain(
      "No comparison dimensions were supported by the available metadata and abstracts.",
    );
    expect(html).not.toContain("<table>");
  });

  it("announces and exposes the ephemeral result without provider internals", () => {
    const html = renderToStaticMarkup(createElement(PaperComparisonResult, {
      result: comparisonResult(),
    }));

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Comparison ready");
    expect(html).toContain(
      '<h3 id="paper-comparison-result-heading" tabindex="-1">Comparison result</h3>',
    );
    expect(html).toContain('<time dateTime="2026-09-06T08:00:00.000Z">');
    expect(html).toContain("This result is not saved.");
    expect(html).not.toContain("provider-model-that-must-remain-hidden");
    expect(html).not.toContain("abstract-comparison-v1");
  });
});

describe("Paper comparison workflow wiring", () => {
  it("renders nested comparison errors as alerts beneath an h3 with recovery", () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(
        "div",
        null,
        createElement("h1", null, "Space"),
        createElement("h2", null, "Compare saved papers"),
        createElement(PaperComparisonNestedError, {
          title: "Saved papers could not be loaded",
          message: "Saved papers could not be loaded for this comparison.",
          onRetry: vi.fn(),
        }),
      ),
    ));

    expect(html).toContain('class="rw-paper-comparison-inline-error" role="alert"');
    expect(html).toContain("<h3>Saved papers could not be loaded</h3>");
    expect(html).toContain("Try again");
    expect(html).not.toContain("<h2>Saved papers could not be loaded</h2>");
  });

  it("registers only the Space-scoped lazy route and Saved Papers entry", () => {
    const routerSource = readFileSync(
      new URL("../../src/app/router.tsx", import.meta.url),
      "utf8",
    );
    const savedPapersSource = readFileSync(
      new URL("../../src/features/research/pages/saved-papers-page.tsx", import.meta.url),
      "utf8",
    );

    expect(routerSource).toMatch(
      /path: "saved-papers\/compare",\s+lazy: \(\) => import\("\.\.\/features\/research\/pages\/paper-comparison-page"\)/u,
    );
    expect(savedPapersSource).toContain("getPaperComparisonPath(space.id)");
    expect(savedPapersSource).toContain("Compare papers");
    expect(routerSource).not.toContain('path: "research/compare"');
  });

  it("keeps generation explicit, local-only, and without automatic retry", () => {
    const pageSource = readFileSync(
      new URL("../../src/features/research/pages/paper-comparison-page.tsx", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("useMutation({");
    expect(pageSource).toContain("retry: false");
    expect(pageSource).toContain("comparisonMutation.mutate(");
    expect(pageSource).toContain("createPaperComparisonMutationOwnership(space.id, selectedPaperIds)");
    expect(pageSource).toContain('aria-live="polite"');
    expect(pageSource).toContain('role="status"');
    expect(pageSource).not.toMatch(/localStorage|sessionStorage|setQueryData/u);
  });

  it("exposes one responsive comparison presentation at each breakpoint", () => {
    const styles = readFileSync(
      new URL("../../src/styles/global.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(".rw-paper-comparison-result__compact-view { display: none; }");
    expect(styles).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?\.rw-paper-comparison-result__table-view \{ display: none; \}[\s\S]*?\.rw-paper-comparison-result__compact-view \{ display: grid;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.rw-paper-comparison-result__observations \{ grid-template-columns: 1fr; \}/u,
    );
    expect(styles).not.toMatch(/html, body \{ min-width: 0; \}/u);
    expect(styles).toContain(".rw-paper-comparison-page > * { max-width: 100%; }");
  });
});
