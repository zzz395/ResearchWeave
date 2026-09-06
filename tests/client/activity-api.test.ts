/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from "vitest";

import { listActivity } from "../../src/features/activity/api/activity";
import {
  ACTIVITY_PAGE_SIZE,
  activityListQueryOptions,
} from "../../src/features/activity/api/activity-list-query";

function activityResponse(nextCursor: string | null = null) {
  return new Response(JSON.stringify({ events: [], nextCursor }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Activity client API", () => {
  it.each([
    [{ limit: 20 }, "/api/v1/activity?limit=20"],
    [
      { limit: 20, category: "agents" as const },
      "/api/v1/activity?limit=20&category=agents",
    ],
    [
      { limit: 20, spaceId: "10000000-0000-4000-8000-000000000001" },
      "/api/v1/activity?limit=20&spaceId=10000000-0000-4000-8000-000000000001",
    ],
    [
      { limit: 20, cursor: "b3BhcXVl" },
      "/api/v1/activity?limit=20&cursor=b3BhcXVl",
    ],
    [
      {
        limit: 20,
        category: "knowledge" as const,
        spaceId: "10000000-0000-4000-8000-000000000001",
        cursor: "b3BhcXVl",
      },
      "/api/v1/activity?limit=20&category=knowledge&spaceId=10000000-0000-4000-8000-000000000001&cursor=b3BhcXVl",
    ],
  ])("serializes only defined query values for %#", async (query, expectedPath) => {
    const fetchMock = vi.fn().mockResolvedValue(activityResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(listActivity(query)).resolves.toEqual({ events: [], nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedPath);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      credentials: "include",
    }));
  });

  it("validates the response contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ events: [], nextCursor: "not canonical base64url!" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(listActivity({ limit: 20 })).rejects.toEqual(expect.objectContaining({
      code: "api_contract_mismatch",
    }));
  });
});

describe("Activity infinite query boundary", () => {
  it("keys the filter set and fixed page size without a cursor", () => {
    const filters = {
      category: "research" as const,
      spaceId: "10000000-0000-4000-8000-000000000001",
    };
    const options = activityListQueryOptions(filters);

    expect(ACTIVITY_PAGE_SIZE).toBe(20);
    expect(options.queryKey).toEqual([
      "activity",
      "list",
      { ...filters, limit: 20 },
    ]);
    expect(JSON.stringify(options.queryKey)).not.toContain("cursor");
    expect(options.initialPageParam).toBeUndefined();
  });

  it("uses the server cursor and terminates when it is null", () => {
    const options = activityListQueryOptions({});
    const nextPage = { events: [], nextCursor: "b3BhcXVl" };
    const finalPage = { events: [], nextCursor: null };

    expect(options.getNextPageParam?.(nextPage, [nextPage], undefined, [undefined]))
      .toBe("b3BhcXVl");
    expect(options.getNextPageParam?.(finalPage, [finalPage], undefined, [undefined]))
      .toBeUndefined();
  });
});
