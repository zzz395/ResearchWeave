// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResearchPaperSummary } from "../../shared/contracts/research";
import type { ResearchSpace } from "../../shared/contracts/spaces";
import type { User } from "../../shared/contracts/auth";
import { AppProviders } from "../../src/app/providers";
import { queryClient, transitionClientActor } from "../../src/app/query-client";
import { PaperAiSummary } from "../../src/features/research/components/paper-ai-summary";
import { actorOwnership } from "../../src/features/auth/actor-ownership";
import { useAuth } from "../../src/features/auth/auth-state";
import { Component as LoginPage } from "../../src/features/auth/pages/login-page";
import { Component as RegisterPage } from "../../src/features/auth/pages/register-page";
import { Component as NewSpacePage } from "../../src/features/spaces/pages/new-space-page";
import { ApiClientError, AUTH_EXPIRED_EVENT } from "../../src/services/api/client";
import { useRealtime } from "../../src/services/realtime/realtime-context";

const authApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}));

const researchApi = vi.hoisted(() => ({
  getResearchPaperSummary: vi.fn(),
  ensureResearchPaperSummary: vi.fn(),
}));

const spaceApi = vi.hoisted(() => ({
  createSpace: vi.fn(),
}));

vi.mock("../../src/features/auth/api/auth", () => authApi);
vi.mock("../../src/features/research/api/research", () => researchApi);
vi.mock("../../src/features/spaces/api/spaces", () => spaceApi);

const userA: User = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "alice@example.com",
  displayName: "Alice",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const userB: User = {
  id: "20000000-0000-4000-8000-000000000002",
  email: "bob@example.com",
  displayName: "Bob",
  createdAt: "2026-01-02T00:00:00.000Z",
};

const summaryA: ResearchPaperSummary = {
  paperId: "30000000-0000-4000-8000-000000000003",
  sourceVersion: 1,
  sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
  model: "test-model",
  promptVersion: "test-v1",
  generatedAt: "2026-01-03T00:00:00.000Z",
  overview: "Alice-only summary",
  keyContributions: [],
  methodHighlights: [],
  findings: [],
  caveats: [],
};

const aliceSpaceId = "40000000-0000-4000-8000-000000000004";

const createdSpace: ResearchSpace = {
  id: aliceSpaceId,
  name: "Race window space",
  description: null,
  ownerId: userA.id,
  role: "owner",
  createdAt: "2026-01-04T00:00:00.000Z",
  updatedAt: "2026-01-04T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type SocketListener = EventListenerOrEventListenerObject;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeReason: string | null = null;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: SocketListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(_code?: number, reason?: string) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.closeReason = reason ?? "";
    this.emit("close", new Event("close"));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", new Event("open"));
  }

  message(data: string) {
    this.emit("message", new MessageEvent("message", { data }));
  }

  private emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}

function renderWithProviders(children: React.ReactNode) {
  return render(<AppProviders>{children}</AppProviders>);
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function sessionMutationTimeoutError(): ApiClientError {
  return new ApiClientError(
    "The authentication request timed out. Please try again.",
    "session_mutation_timeout",
  );
}

function ActorControls({
  onRealtimeEvent,
  subscribeToAliceSpace = false,
}: {
  onRealtimeEvent?: () => void;
  subscribeToAliceSpace?: boolean;
}) {
  const { logout, retry, setAuthenticatedUser, user } = useAuth();
  const realtime = useRealtime();
  const [localValue, setLocalValue] = useState("initial");

  useEffect(() => {
    if (!subscribeToAliceSpace || user?.id !== userA.id) return;
    return realtime.subscribeSpace(aliceSpaceId, () => onRealtimeEvent?.());
  }, [onRealtimeEvent, realtime, subscribeToAliceSpace, user?.id]);

  return (
    <div>
      <span data-testid="actor">{user?.displayName ?? "anonymous"}</span>
      <span data-testid="local-value">{localValue}</span>
      <button onClick={() => setAuthenticatedUser(userB)} type="button">Become Bob</button>
      <button
        onClick={() => setAuthenticatedUser({ ...userA, displayName: "Alice Updated" })}
        type="button"
      >
        Refresh Alice
      </button>
      <button onClick={() => setLocalValue("changed")} type="button">Change local state</button>
      <button onClick={() => void logout().catch(() => undefined)} type="button">Log out</button>
      <button onClick={retry} type="button">Retry session</button>
    </div>
  );
}

function dispatchAuthExpired(
  snapshot = actorOwnership.current(),
): void {
  globalThis.window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
    detail: { actorId: snapshot.actorId, generation: snapshot.generation },
  }));
}

function ProtectedValue({ load }: { load: (actorId: string) => Promise<string> }) {
  const { user } = useAuth();
  const result = useQuery({
    queryKey: ["protected", "shared"],
    queryFn: () => load(user?.id ?? "anonymous"),
    enabled: user !== null,
    retry: false,
  });
  return <span data-testid="protected-value">{result.data ?? "loading"}</span>;
}

function PendingRealtimeCommand({ onCommand }: { onCommand: (command: Promise<void>) => void }) {
  const realtime = useRealtime();
  return (
    <button
      onClick={() => onCommand(realtime.sendChatMessage(aliceSpaceId, "hello"))}
      type="button"
    >
      Send pending command
    </button>
  );
}

beforeEach(() => {
  queryClient.clear();
  FakeWebSocket.instances = [];
  vi.clearAllMocks();
  authApi.getSession.mockResolvedValue(userA);
  authApi.logout.mockResolvedValue(undefined);
  researchApi.getResearchPaperSummary.mockResolvedValue(null);
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.clear();
});

describe("frontend actor ownership", () => {
  it("R1 removes protected query and mutation state and stops realtime on auth expiry", async () => {
    const pending = deferred<string>();
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    queryClient.setQueryData(["protected", "alice"], "Alice private data");
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => pending.promise,
    });
    void mutation.execute(undefined).catch(() => undefined);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

    await act(async () => {
      dispatchAuthExpired();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("anonymous"));
    expect(queryClient.getQueryData(["protected", "alice"])).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(socket?.readyState).toBe(FakeWebSocket.CLOSED);
    pending.resolve("finished");
  });

  it("R2 signs out locally when the logout acknowledgement is lost", async () => {
    authApi.logout.mockRejectedValueOnce(new Error("connection lost after commit"));
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    queryClient.setQueryData(["protected", "alice"], "Alice private data");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("anonymous"));
    expect(queryClient.getQueryData(["protected", "alice"])).toBeUndefined();
  });

  it("keeps local-first logout authoritative and ignores its timed-out continuation", async () => {
    const remoteLogout = deferred<void>();
    authApi.logout.mockReturnValueOnce(remoteLogout.promise);
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("anonymous"));

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    remoteLogout.reject(sessionMutationTimeoutError());
    await act(async () => Promise.resolve());

    expect(screen.getByTestId("actor").textContent).toBe("Bob");
    expect(queryClient.getQueryData(["auth", "session"])).toEqual(userB);
  });

  it("does not publish a principal or navigate when login times out", async () => {
    authApi.getSession.mockResolvedValueOnce(null);
    authApi.login.mockRejectedValueOnce(sessionMutationTimeoutError());
    renderWithProviders(
      <MemoryRouter initialEntries={["/login?returnTo=/spaces"]}>
        <LoginPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(actorOwnership.current().actorId).toBeNull());

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: userA.email } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("The authentication request timed out. Please try again."))
      .toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/login");
    expect(actorOwnership.current().actorId).toBeNull();
    expect(queryClient.getQueryData(["auth", "session"])).toBeNull();
  });

  it("does not publish a principal or navigate when registration times out", async () => {
    authApi.getSession.mockResolvedValueOnce(null);
    authApi.register.mockRejectedValueOnce(sessionMutationTimeoutError());
    renderWithProviders(
      <MemoryRouter initialEntries={["/register"]}>
        <RegisterPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(actorOwnership.current().actorId).toBeNull());

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: userA.email } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("The authentication request timed out. Please try again."))
      .toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/register");
    expect(actorOwnership.current().actorId).toBeNull();
    expect(queryClient.getQueryData(["auth", "session"])).toBeNull();
  });

  it("R3 never renders Alice cached data after Bob becomes the principal", async () => {
    const bobLoad = deferred<string>();
    const load = vi.fn((actorId: string) => (
      actorId === userA.id ? Promise.resolve("Alice private data") : bobLoad.promise
    ));
    renderWithProviders(<><ActorControls /><ProtectedValue load={load} /></>);
    expect(await screen.findByText("Alice private data")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));

    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    expect(screen.getByTestId("protected-value").textContent).toBe("loading");
    expect(screen.queryByText("Alice private data")).toBeNull();
    bobLoad.resolve("Bob private data");
    expect(await screen.findByText("Bob private data")).toBeTruthy();
  });

  it("R4 discards an old protected query completion after a principal transition", async () => {
    const aliceLoad = deferred<string>();
    const bobLoad = deferred<string>();
    const load = vi.fn((actorId: string) => (
      actorId === userA.id ? aliceLoad.promise : bobLoad.promise
    ));
    renderWithProviders(<><ActorControls /><ProtectedValue load={load} /></>);
    expect(await screen.findByText("Alice")).toBeTruthy();
    await waitFor(() => expect(load).toHaveBeenCalledWith(userA.id));

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(load).toHaveBeenCalledWith(userB.id));
    aliceLoad.resolve("Alice late result");

    await act(async () => Promise.resolve());
    expect(queryClient.getQueryData(["protected", "shared"])).not.toBe("Alice late result");
    expect(screen.queryByText("Alice late result")).toBeNull();
    bobLoad.resolve("Bob result");
    expect(await screen.findByText("Bob result")).toBeTruthy();
  });

  it("R5 discards an old mutation completion before it can write Bob's cache", async () => {
    const generated = deferred<ResearchPaperSummary>();
    researchApi.ensureResearchPaperSummary.mockReturnValueOnce(generated.promise);
    renderWithProviders(
      <>
        <ActorControls />
        <PaperAiSummary paperId={summaryA.paperId} />
      </>,
    );
    expect(await screen.findByText("Generate summary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
    await waitFor(() => expect(researchApi.ensureResearchPaperSummary).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    generated.resolve(summaryA);

    await act(async () => Promise.resolve());
    await waitFor(() => expect(researchApi.getResearchPaperSummary.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(queryClient.getQueryData(["research", "paper", summaryA.paperId, "summary"])).not.toEqual(summaryA);
    expect(screen.queryByText("Alice-only summary")).toBeNull();
  });

  it("R6 does not carry Alice's subscriptions into Bob's websocket", async () => {
    renderWithProviders(<ActorControls subscribeToAliceSpace />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const aliceSocket = FakeWebSocket.instances[0];
    act(() => aliceSocket?.open());
    expect(aliceSocket?.sent.some((frame) => frame.includes(aliceSpaceId))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    const bobSocket = FakeWebSocket.instances[1];
    act(() => bobSocket?.open());

    expect(aliceSocket?.readyState).toBe(FakeWebSocket.CLOSED);
    expect(bobSocket?.sent.some((frame) => frame.includes(aliceSpaceId))).toBe(false);

    queryClient.setQueryData(["spaces", aliceSpaceId], "Bob-owned space data");
    act(() => aliceSocket?.message(JSON.stringify({
      version: 1,
      eventId: "50000000-0000-4000-8000-000000000005",
      occurredAt: "2026-01-04T00:00:00.000Z",
      type: "space.access.revoked",
      spaceId: aliceSpaceId,
      payload: { reason: "membership_removed" },
    })));
    expect(queryClient.getQueryData(["spaces", aliceSpaceId])).toBe("Bob-owned space data");
  });

  it("R7 rejects pending realtime commands during a principal transition", async () => {
    let command: Promise<void> | undefined;
    renderWithProviders(
      <>
        <ActorControls />
        <PendingRealtimeCommand onCommand={(nextCommand) => { command = nextCommand; }} />
      </>,
    );
    expect(await screen.findByText("Alice")).toBeTruthy();
    act(() => FakeWebSocket.instances[0]?.open());
    fireEvent.click(screen.getByRole("button", { name: "Send pending command" }));
    expect(command).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));

    await expect(command).rejects.toThrow("Realtime connection was closed.");
  });

  it("R8 preserves actor-owned state for an equivalent user object", async () => {
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const socket = FakeWebSocket.instances[0];
    const lifetime = actorOwnership.current();
    act(() => socket?.open());
    queryClient.setQueryData(["protected", "alice"], "Alice private data");
    fireEvent.click(screen.getByRole("button", { name: "Change local state" }));
    expect(screen.getByTestId("local-value").textContent).toBe("changed");

    fireEvent.click(screen.getByRole("button", { name: "Refresh Alice" }));

    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Alice Updated"));
    expect(screen.getByTestId("local-value").textContent).toBe("changed");
    expect(queryClient.getQueryData(["protected", "alice"])).toBe("Alice private data");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket?.readyState).toBe(FakeWebSocket.OPEN);
    expect(actorOwnership.current()).toBe(lifetime);
    expect(lifetime.signal.aborted).toBe(false);
  });

  it("ignores an Alice auth-expiry event after Bob owns the client", async () => {
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const aliceOwnership = actorOwnership.current();

    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    act(() => dispatchAuthExpired(aliceOwnership));

    expect(screen.getByTestId("actor").textContent).toBe("Bob");
    expect(queryClient.getQueryData(["auth", "session"])).toEqual(userB);
  });

  it("does not let repeated expiry for one generation sign out a later actor", async () => {
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const aliceOwnership = actorOwnership.current();

    act(() => dispatchAuthExpired(aliceOwnership));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("anonymous"));
    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    act(() => dispatchAuthExpired(aliceOwnership));

    expect(screen.getByTestId("actor").textContent).toBe("Bob");
    expect(queryClient.getQueryData(["auth", "session"])).toEqual(userB);
  });

  it("does not publish a stale Alice session refetch after Bob is explicit", async () => {
    const staleSession = deferred<User | null>();
    authApi.getSession
      .mockResolvedValueOnce(userA)
      .mockReturnValueOnce(staleSession.promise);
    renderWithProviders(<ActorControls />);
    expect(await screen.findByText("Alice")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry session" }));
    await waitFor(() => expect(authApi.getSession).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    staleSession.resolve(userA);
    await act(async () => Promise.resolve());

    expect(screen.getByTestId("actor").textContent).toBe("Bob");
    expect(queryClient.getQueryData(["auth", "session"])).toEqual(userB);
  });

  it("blocks an old realtime frame in the transition-before-cleanup window", async () => {
    const listener = vi.fn();
    const revoked = vi.fn();
    window.addEventListener("researchweave:space-access-revoked", revoked);
    renderWithProviders(<ActorControls onRealtimeEvent={listener} subscribeToAliceSpace />);
    expect(await screen.findByText("Alice")).toBeTruthy();
    const aliceSocket = FakeWebSocket.instances[0];
    act(() => aliceSocket?.open());
    queryClient.setQueryData(["spaces", aliceSpaceId], "Bob-owned cache sentinel");

    act(() => {
      transitionClientActor(userB.id);
      aliceSocket?.message(JSON.stringify({
        version: 1,
        eventId: "50000000-0000-4000-8000-000000000005",
        occurredAt: "2026-01-04T00:00:00.000Z",
        type: "space.access.revoked",
        spaceId: aliceSpaceId,
        payload: { reason: "membership_removed" },
      }));
    });

    expect(listener).not.toHaveBeenCalled();
    expect(revoked).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["spaces", aliceSpaceId])).toBeUndefined();
    window.removeEventListener("researchweave:space-access-revoked", revoked);
  });

  it("retires a pending realtime command synchronously with its actor generation", async () => {
    let command: Promise<void> | undefined;
    const rejected = vi.fn();
    renderWithProviders(
      <>
        <ActorControls />
        <PendingRealtimeCommand onCommand={(nextCommand) => { command = nextCommand; }} />
      </>,
    );
    expect(await screen.findByText("Alice")).toBeTruthy();
    act(() => FakeWebSocket.instances[0]?.open());
    fireEvent.click(screen.getByRole("button", { name: "Send pending command" }));
    void command?.catch(rejected);

    act(() => transitionClientActor(userB.id));
    await act(async () => Promise.resolve());

    expect(rejected).toHaveBeenCalledOnce();
  });

  it("ignores an old realtime ACK in the transition-before-cleanup window", async () => {
    let command: Promise<void> | undefined;
    const fulfilled = vi.fn();
    const rejected = vi.fn();
    renderWithProviders(
      <>
        <ActorControls />
        <PendingRealtimeCommand onCommand={(nextCommand) => { command = nextCommand; }} />
      </>,
    );
    expect(await screen.findByText("Alice")).toBeTruthy();
    const aliceSocket = FakeWebSocket.instances[0];
    act(() => aliceSocket?.open());
    fireEvent.click(screen.getByRole("button", { name: "Send pending command" }));
    void command?.then(fulfilled, rejected);
    const sentCommand = JSON.parse(aliceSocket?.sent.at(-1) ?? "{}") as { requestId?: string };

    act(() => {
      transitionClientActor(userB.id);
      aliceSocket?.message(JSON.stringify({
        version: 1,
        type: "ack",
        requestId: sentCommand.requestId,
        payload: {},
      }));
    });
    await act(async () => Promise.resolve());

    expect(rejected).toHaveBeenCalledOnce();
    expect(fulfilled).not.toHaveBeenCalled();
  });

  it("re-checks ownership after the follow-on invalidation await", async () => {
    const creation = deferred<ResearchSpace>();
    const invalidation = deferred<void>();
    spaceApi.createSpace.mockReturnValueOnce(creation.promise);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")
      .mockReturnValueOnce(invalidation.promise);
    renderWithProviders(
      <MemoryRouter>
        <ActorControls />
        <NewSpacePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Alice")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: createdSpace.name } });
    fireEvent.click(screen.getByRole("button", { name: "Create space" }));
    await waitFor(() => expect(spaceApi.createSpace).toHaveBeenCalledOnce());

    creation.resolve(createdSpace);
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Become Bob" }));
    await waitFor(() => expect(screen.getByTestId("actor").textContent).toBe("Bob"));
    invalidation.resolve();
    await act(async () => Promise.resolve());

    expect(queryClient.getQueryData(["spaces", createdSpace.id])).toBeUndefined();
  });
});
