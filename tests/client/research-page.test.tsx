// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Component as ResearchPage } from "../../src/features/research/pages/research-page";
import { ApiClientError } from "../../src/services/api/client";

const researchApi = vi.hoisted(() => ({
  savePaperToSpace: vi.fn(),
  searchResearchPapers: vi.fn(),
}));

vi.mock("../../src/features/research/api/research", () => researchApi);

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: 0,
      },
    },
  });
  researchApi.searchResearchPapers.mockRejectedValue(new ApiClientError(
    "Research search is temporarily unavailable.",
    "research_temporarily_unavailable",
    503,
    "request-1",
  ));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("Research Search failure behavior", () => {
  it("does not repeat a failed backend search until the user chooses Try again", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/research?q=retrieval+augmented+generation&page=1&sort=relevance"]}>
          <ResearchPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Research is temporarily unavailable" }))
      .toBeTruthy();
    expect(researchApi.searchResearchPapers).toHaveBeenCalledOnce();
    expect(screen.queryByText("Searching arXiv")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(researchApi.searchResearchPapers).toHaveBeenCalledTimes(2));
  });
});
