/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import { getOverview } from "../../src/features/overview/api/overview";

afterEach(() => vi.unstubAllGlobals());

describe("Overview client API", () => {
  it("loads the complete bounded view from the single Overview endpoint", async () => {
    const overview = { recentSpaces: [], activeWork: [], recentActivity: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(overview), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOverview()).resolves.toEqual(overview);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/overview",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("validates the Overview response contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      recentSpaces: [],
      activeWork: [{ kind: "invented_progress", percent: 75 }],
      recentActivity: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getOverview()).rejects.toEqual(expect.objectContaining({
      code: "api_contract_mismatch",
    }));
  });
});
