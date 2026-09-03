import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { PersistentResearchPaper } from "../../shared/contracts/research";
import { EmptyState, QueryState, SectionHeader } from "../../src/components/ui/feedback";
import { getChatLiveAnnouncement } from "../../src/features/chat/chat-live-announcement";
import { ChatLiveAnnouncer } from "../../src/features/chat/pages/space-chat-page";
import { PaperSummary } from "../../src/features/research/components/paper-presentation";
import { PaperAbstract } from "../../src/features/research/pages/research-paper-page";
import { PageHeader } from "../../src/features/spaces/components/space-page";

describe("Phase 8B shared presentation semantics", () => {
  it("marks the destructive confirmation as an ARIA modal", () => {
    const source = readFileSync(
      new URL("../../src/features/spaces/pages/space-settings-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/<Dialog\.Content\s+aria-modal="true"\s+className="rw-dialog-card">/);
  });

  it("marks the Save Paper dialog as an ARIA modal", () => {
    const source = readFileSync(
      new URL("../../src/features/research/components/save-paper-dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/<Dialog\.Content\s+aria-modal="true"\s+className="rw-dialog-card">/);
  });

  it("renders a PageHeader without manufacturing a kicker", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "Research" }));
    expect(html).toContain("<h1>Research</h1>");
    expect(html).not.toContain("rw-page-kicker");
  });

  it("uses accessible query status and error semantics", () => {
    const loading = renderToStaticMarkup(createElement(QueryState, {
      label: "Loading documents",
      status: "loading",
    }));
    const error = renderToStaticMarkup(createElement(QueryState, {
      label: "Documents could not be loaded.",
      status: "error",
    }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
  });

  it("keeps heading hierarchy explicit and EmptyState lightweight", () => {
    const section = renderToStaticMarkup(createElement(SectionHeader, {
      count: "3 saved",
      headingLevel: 3,
      title: "Documents",
    }));
    const empty = renderToStaticMarkup(createElement(EmptyState, null, "No records"));
    expect(section).toContain("<h3>Documents</h3>");
    expect(section).toContain("3 saved");
    expect(empty).toContain("rw-empty-state-shell");
  });

  it("gives the paper abstract a real heading", () => {
    const html = renderToStaticMarkup(createElement(PaperAbstract, { abstract: "Evidence summary." }));
    expect(html).toContain('<h2 id="paper-abstract-heading">Abstract</h2>');
  });

  it("announces a new realtime message in a dedicated live region", () => {
    const html = renderToStaticMarkup(createElement(ChatLiveAnnouncer, {
      announcement: { id: "message-1", text: "New message from Ada." },
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("New message from Ada.");
  });

  it("announces a realtime message from another user", () => {
    expect(getChatLiveAnnouncement({
      id: "message-1",
      sender: {
        id: "user-2",
        displayName: "Ada",
        email: "ada@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    }, "user-1")).toEqual({
      id: "message-1",
      text: "New message from Ada.",
    });
  });

  it("does not announce a realtime message from the current user", () => {
    expect(getChatLiveAnnouncement({
      id: "message-1",
      sender: {
        id: "user-1",
        displayName: "Ada",
        email: "ada@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    }, "user-1")).toBeNull();
  });

  it("keeps shared paper rows intact with long editorial content", () => {
    const paper: PersistentResearchPaper = {
      id: "10000000-0000-4000-8000-000000000001",
      canonicalArxivId: "2608.00001",
      versionedArxivId: "2608.00001v2",
      version: 2,
      title: "A deliberately long research paper title that must remain available to Research and Saved Papers",
      abstract: "A durable abstract preview for the shared paper presentation.",
      authors: ["Ada Lovelace", "Grace Hopper", "Edsger Dijkstra"],
      primaryCategory: "cs.AI",
      categories: ["cs.AI", "cs.IR", "cs.SE"],
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      fetchedAt: "2026-08-03T00:00:00.000Z",
      absUrl: "https://arxiv.org/abs/2608.00001",
      pdfUrl: "https://arxiv.org/pdf/2608.00001",
    };
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ["/research?q=rag"] },
      createElement(PaperSummary, { actions: "Save action", paper }),
    ));
    expect(html).toContain(paper.title);
    expect(html).toContain("Ada Lovelace, Grace Hopper, Edsger Dijkstra");
    expect(html).toContain("cs.SE");
    expect(html).toContain("Save action");
  });
});
