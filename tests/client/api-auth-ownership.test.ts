// @vitest-environment jsdom

import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { actorOwnership } from "../../src/features/auth/actor-ownership";
import {
  apiRequest,
  AUTH_EXPIRED_EVENT,
} from "../../src/services/api/client";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({
    error: {
      code: "unauthorized",
      message: "Authentication is required.",
      requestId: "request-auth-race",
    },
  }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API actor ownership", () => {
  it("emits ownership-qualified expiry for a current protected 401", async () => {
    const expired = vi.fn();
    actorOwnership.transition("current-alice");
    const ownership = actorOwnership.current();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorizedResponse()));

    await expect(apiRequest("/api/v1/protected", z.object({})))
      .rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect((expired.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      actorId: ownership.actorId,
      generation: ownership.generation,
    });
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("does not emit auth expiry for Alice's stale protected 401 after Bob", async () => {
    const response = deferred<Response>();
    const expired = vi.fn();
    actorOwnership.transition("api-alice");
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));

    const request = apiRequest("/api/v1/protected", z.object({}));
    actorOwnership.transition("api-bob");
    response.resolve(unauthorizedResponse());

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("passes a linked ownership signal to protected fetch and aborts it on transition", async () => {
    const fetchStarted = deferred<RequestInit>();
    actorOwnership.transition("signal-alice");
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => {
      fetchStarted.resolve(init);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(
          init.signal?.reason instanceof Error
            ? init.signal.reason
            : new DOMException("Request cancelled", "AbortError"),
        ), { once: true });
      });
    }));

    const queryController = new AbortController();
    const request = apiRequest("/api/v1/protected", z.object({}), {
      signal: queryController.signal,
    });
    const init = await fetchStarted.promise;
    expect(init.signal).not.toBe(queryController.signal);
    expect(init.signal?.aborted).toBe(false);

    actorOwnership.transition("signal-bob");

    expect(init.signal?.aborted).toBe(true);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves abort semantics and never turns an aborted request into auth expiry", async () => {
    const expired = vi.fn();
    actorOwnership.transition("abort-alice");
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(
          init.signal?.reason instanceof Error
            ? init.signal.reason
            : new DOMException("Request cancelled", "AbortError"),
        ), { once: true });
      })
    )));
    const controller = new AbortController();

    const request = apiRequest("/api/v1/protected", z.object({}), { signal: controller.signal });
    controller.abort(new DOMException("Query cancelled", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("preserves actor cancellation while a protected response body is pending", async () => {
    const bodyStarted = deferred<void>();
    const body = deferred<unknown>();
    const expired = vi.fn();
    const response = unauthorizedResponse();
    vi.spyOn(response, "json").mockImplementation(() => {
      bodyStarted.resolve();
      return body.promise;
    });
    actorOwnership.transition("body-alice");
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => body.reject(
        init.signal?.reason instanceof Error
          ? init.signal.reason
          : new DOMException("Request cancelled", "AbortError"),
      ), { once: true });
      return Promise.resolve(response);
    }));

    const request = apiRequest("/api/v1/protected", z.object({}));
    await bodyStarted.promise;
    actorOwnership.transition("body-bob");

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(request).rejects.not.toMatchObject({ code: "invalid_api_response" });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("preserves caller cancellation while a protected response body is pending", async () => {
    const bodyStarted = deferred<void>();
    const body = deferred<unknown>();
    const response = new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    vi.spyOn(response, "json").mockImplementation(() => {
      bodyStarted.resolve();
      return body.promise;
    });
    actorOwnership.transition("caller-body-alice");
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => body.reject(
        init.signal?.reason instanceof Error
          ? init.signal.reason
          : new DOMException("Request cancelled", "AbortError"),
      ), { once: true });
      return Promise.resolve(response);
    }));
    const controller = new AbortController();

    const request = apiRequest("/api/v1/protected", z.object({}), {
      signal: controller.signal,
    });
    await bodyStarted.promise;
    controller.abort(new DOMException("Query cancelled", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(request).rejects.not.toMatchObject({ code: "invalid_api_response" });
  });

  it("keeps malformed JSON classified as an invalid API response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(apiRequest("/api/v1/protected", z.object({})))
      .rejects.toMatchObject({ code: "invalid_api_response" });
  });

  it("keeps an ordinary fetch rejection classified as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection failed")));

    await expect(apiRequest("/api/v1/protected", z.object({})))
      .rejects.toMatchObject({ code: "network_error" });
  });

  it.each(["session", "credential", "session-mutation"] as const)(
    "does not emit global auth expiry for a %s 401",
    async (authMode) => {
      const expired = vi.fn();
      actorOwnership.transition("mode-alice");
      window.addEventListener(AUTH_EXPIRED_EVENT, expired);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorizedResponse()));

      await expect(apiRequest("/api/v1/auth/test", z.object({}), { authMode }))
        .rejects.toMatchObject({ status: 401 });
      expect(expired).not.toHaveBeenCalled();
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    },
  );
});
