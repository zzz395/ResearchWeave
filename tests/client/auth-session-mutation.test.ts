import { afterEach, describe, expect, it, vi } from "vitest";

import type { User } from "../../shared/contracts/auth";
import { login, logout, register } from "../../src/features/auth/api/auth";
import { SESSION_MUTATION_TIMEOUT_MS } from "../../src/features/auth/session-mutation";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const userA: User = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "alice@example.com",
  displayName: "Alice",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function authenticatedResponse(user: User): Response {
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rejectWhenAborted(signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const handleAbort = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Request cancelled", "AbortError"),
    );
    if (signal.aborted) handleAbort();
    else signal.addEventListener("abort", handleAbort, { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session mutation boundary", () => {
  it("keeps a pending logout as the only network dispatch and rejects a competing login", async () => {
    const logoutResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(logoutResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogout = logout();
    await Promise.resolve();
    const competingLogin = login({ email: userA.email, password: "correct horse battery staple" });

    await expect(competingLogin).rejects.toMatchObject({ code: "session_mutation_in_progress" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/logout");

    logoutResponse.resolve(new Response(null, { status: 204 }));
    await expect(pendingLogout).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(authenticatedResponse(userA));
    await expect(login({ email: userA.email, password: "correct horse battery staple" }))
      .resolves.toEqual(userA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/login");
  });

  it("never dispatches concurrent login and register cookie writes", async () => {
    const loginResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(loginResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogin = login({ email: userA.email, password: "correct horse battery staple" });
    await Promise.resolve();
    const competingRegister = register({
      displayName: "Bob",
      email: "bob@example.com",
      password: "correct horse battery staple",
    });

    await expect(competingRegister).rejects.toMatchObject({ code: "session_mutation_in_progress" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/login");

    loginResponse.resolve(authenticatedResponse(userA));
    await expect(pendingLogin).resolves.toEqual(userA);
  });

  it("bounds a fetch-pending login and releases the mutex after abort settlement", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return rejectWhenAborted(requestSignal);
      })
      .mockResolvedValueOnce(authenticatedResponse(userA));
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogin = login({
      email: userA.email,
      password: "correct horse battery staple",
    });
    const timeoutResult = expect(pendingLogin).rejects.toMatchObject({
      code: "session_mutation_timeout",
      status: undefined,
    });
    expect(SESSION_MUTATION_TIMEOUT_MS).toBe(15_000);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(SESSION_MUTATION_TIMEOUT_MS);

    expect(requestSignal?.aborted).toBe(true);
    await timeoutResult;
    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).resolves.toEqual(userA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds a response-body-pending login and releases the mutex after body abort", async () => {
    vi.useFakeTimers();
    const bodyStarted = deferred<void>();
    const body = deferred<unknown>();
    const response = authenticatedResponse(userA);
    vi.spyOn(response, "json").mockImplementation(() => {
      bodyStarted.resolve();
      return body.promise;
    });
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        requestSignal.addEventListener("abort", () => body.reject(
          requestSignal?.reason instanceof Error
            ? requestSignal.reason
            : new DOMException("Request cancelled", "AbortError"),
        ), { once: true });
        return Promise.resolve(response);
      })
      .mockResolvedValueOnce(authenticatedResponse(userA));
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogin = login({
      email: userA.email,
      password: "correct horse battery staple",
    });
    const timeoutResult = expect(pendingLogin)
      .rejects.toMatchObject({ code: "session_mutation_timeout" });
    await bodyStarted.promise;
    await vi.advanceTimersByTimeAsync(SESSION_MUTATION_TIMEOUT_MS);

    await timeoutResult;
    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).resolves.toEqual(userA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not unlock before the deadline or before abort-induced settlement", async () => {
    vi.useFakeTimers();
    const transport = deferred<Response>();
    const abortObserved = deferred<AbortSignal>();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        requestSignal.addEventListener("abort", () => abortObserved.resolve(requestSignal!), {
          once: true,
        });
        return transport.promise;
      })
      .mockResolvedValueOnce(authenticatedResponse(userA));
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogout = logout();
    await vi.advanceTimersByTimeAsync(SESSION_MUTATION_TIMEOUT_MS - 1);

    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).rejects.toMatchObject({ code: "session_mutation_in_progress" });
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const abortedSignal = await abortObserved.promise;
    expect(abortedSignal.aborted).toBe(true);
    await expect(register({
      displayName: "Bob",
      email: "bob@example.com",
      password: "correct horse battery staple",
    })).rejects.toMatchObject({ code: "session_mutation_in_progress" });
    expect(fetchMock).toHaveBeenCalledOnce();

    transport.reject(abortedSignal.reason);
    await expect(pendingLogout).rejects.toMatchObject({ code: "session_mutation_timeout" });
    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).resolves.toEqual(userA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a timed-out logout and permits a later login", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce((_path: string, init: RequestInit) => (
        rejectWhenAborted(init.signal as AbortSignal)
      ))
      .mockResolvedValueOnce(authenticatedResponse(userA));
    vi.stubGlobal("fetch", fetchMock);

    const pendingLogout = logout();
    const timeoutResult = expect(pendingLogout)
      .rejects.toMatchObject({ code: "session_mutation_timeout" });
    await vi.advanceTimersByTimeAsync(SESSION_MUTATION_TIMEOUT_MS);

    await timeoutResult;
    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).resolves.toEqual(userA);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/logout");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/login");
  });

  it("clears a completed mutation deadline before the next mutex owner starts", async () => {
    vi.useFakeTimers();
    const secondResponse = deferred<Response>();
    let secondSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authenticatedResponse(userA))
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        secondSignal = init.signal as AbortSignal;
        return secondResponse.promise;
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(login({
      email: userA.email,
      password: "correct horse battery staple",
    })).resolves.toEqual(userA);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    const secondLogin = login({
      email: userA.email,
      password: "correct horse battery staple",
    });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5_001);

    expect(secondSignal?.aborted).toBe(false);
    secondResponse.resolve(authenticatedResponse(userA));
    await expect(secondLogin).resolves.toEqual(userA);
    expect(vi.getTimerCount()).toBe(0);
  });
});
