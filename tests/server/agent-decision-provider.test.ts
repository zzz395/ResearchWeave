import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentDecisionProviderError,
  createAgentDecisionActions,
  isAgentDecisionProviderError,
  type AgentDecisionProviderInput,
} from "../../server/modules/agents/decision-provider";
import {
  RESEARCH_AGENT_ORCHESTRATION_PROMPT_VERSION,
  researchAgentV1PromptDefinition,
} from "../../server/modules/agents/orchestration-prompts";
import { askKnowledgeArgumentsSchema } from "../../server/modules/agents/tools/ask-knowledge";
import { searchArxivArgumentsSchema } from "../../server/modules/agents/tools/search-arxiv";
import { searchKnowledgeBaseArgumentsSchema } from "../../server/modules/agents/tools/search-knowledge-base";
import type { AgentToolDescriptor } from "../../server/modules/agents/tools/registry";
import { OpenAICompatibleAgentDecisionProvider } from "../../server/integrations/agent-decision/openai-compatible-provider";

const descriptors: readonly AgentToolDescriptor[] = [
  {
    name: "search_arxiv",
    description: "Search arXiv abstracts.",
    argumentsSchema: searchArxivArgumentsSchema,
  },
  {
    name: "search_knowledge_base",
    description: "Search indexed knowledge.",
    argumentsSchema: searchKnowledgeBaseArgumentsSchema,
  },
  {
    name: "ask_knowledge",
    description: "Answer from indexed knowledge.",
    argumentsSchema: askKnowledgeArgumentsSchema,
  },
];

const actions = createAgentDecisionActions(descriptors);

function toolCallEnvelope(name: string, arguments_: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-test",
    model: "test-model",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(arguments_) },
            },
          ],
        },
        ...overrides,
      },
    ],
    usage: { total_tokens: 10 },
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function input(overrides: Partial<AgentDecisionProviderInput> = {}): AgentDecisionProviderInput {
  return {
    promptVersion: RESEARCH_AGENT_ORCHESTRATION_PROMPT_VERSION,
    context: {
      taskPrompt: "Find grounded evidence about bounded agents.",
      completedToolCalls: [
        {
          sequence: 1,
          toolName: "search_arxiv",
          safeArguments: { query: "bounded agents" },
          observation: { resultCount: 1 },
          evidenceIds: ["E1"],
        },
      ],
    },
    offeredActions: actions,
    limits: { timeoutMs: 30_000, maxAttempts: 2, responseMaxBytes: 65_536 },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function provider(fetchImplementation: typeof fetch) {
  return new OpenAICompatibleAgentDecisionProvider({
    baseUrl: "https://provider.example/v1/",
    apiKey: "secret-api-key",
    model: "test-model",
    fetchImplementation,
  });
}

function capturedRequestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a string request body.");
  return body;
}

async function capturedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

function expectSafeProviderError(error: unknown, code: string): void {
  expect(isAgentDecisionProviderError(error)).toBe(true);
  expect(error).toMatchObject({ code });
  expect(JSON.stringify(error)).toBe(JSON.stringify({ code }));
  expect((error as AgentDecisionProviderError).stack).toBeUndefined();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Agent decision action definitions", () => {
  it("copies descriptors in order and appends the fixed control action", () => {
    const mutable = [...descriptors];
    const created = createAgentDecisionActions(mutable);
    mutable.reverse();

    expect(created.map((action) => [action.kind, action.name])).toEqual([
      ["tool", "search_arxiv"],
      ["tool", "search_knowledge_base"],
      ["tool", "ask_knowledge"],
      ["control", "submit_final_answer"],
    ]);
    expect(Object.isFrozen(created)).toBe(true);
    expect(created.every(Object.isFrozen)).toBe(true);
  });

  it("rejects duplicate descriptor names", () => {
    expect(() => createAgentDecisionActions([descriptors[0], descriptors[0]])).toThrow(
      "Duplicate Agent decision action name",
    );
  });

  it("projects all fixed schemas deterministically and strictly", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope("search_arxiv", { query: "agents" }))),
    );
    await provider(fetchMock).decide(input());
    const request = JSON.parse(capturedRequestBody(fetchMock)) as {
      tools: Array<{
        type: string;
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        };
      }>;
    };

    expect(request.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search_arxiv",
          description: "Search arXiv abstracts.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 2, maxLength: 200 },
              page: { default: 1, type: "integer", minimum: 1, maximum: 20 },
              pageSize: { default: 5, type: "integer", minimum: 1, maximum: 5 },
              sort: {
                default: "relevance",
                type: "string",
                enum: ["relevance", "submitted", "updated"],
              },
            },
            required: ["query", "page", "pageSize", "sort"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_knowledge_base",
          description: "Search indexed knowledge.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 2, maxLength: 2_000 },
              limit: { default: 8, type: "integer", minimum: 1, maximum: 8 },
            },
            required: ["query", "limit"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "ask_knowledge",
          description: "Answer from indexed knowledge.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 2, maxLength: 2_000 },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "submit_final_answer",
          description:
            "Submit the final grounded answer. Cite only evidence identifiers exposed in the decision context, or use insufficient_context with no evidence identifiers.",
          parameters: {
            oneOf: [
              {
                type: "object",
                properties: {
                  status: { type: "string", const: "answered" },
                  answer: { type: "string", minLength: 1, maxLength: 8_000 },
                  evidenceIds: {
                    minItems: 1,
                    maxItems: 32,
                    type: "array",
                    items: {
                      type: "string",
                      pattern: "^E(?:[1-9]|[12][0-9]|3[0-2])$",
                    },
                  },
                },
                required: ["status", "answer", "evidenceIds"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: {
                  status: { type: "string", const: "insufficient_context" },
                  answer: { type: "string", minLength: 1, maxLength: 8_000 },
                  evidenceIds: {
                    minItems: 0,
                    maxItems: 0,
                    type: "array",
                    items: {
                      type: "string",
                      pattern: "^E(?:[1-9]|[12][0-9]|3[0-2])$",
                    },
                  },
                },
                required: ["status", "answer", "evidenceIds"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
    ]);
    expect(request.tools.every((tool) => !("$schema" in tool.function.parameters))).toBe(true);
  });
});

describe("OpenAI-compatible Agent decision provider", () => {
  it("sends the exact non-streaming action request without hidden state", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope("search_arxiv", { query: " agents " }))),
    );
    const decision = await provider(fetchMock).decide(input());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({
      authorization: "Bearer secret-api-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(capturedRequestBody(fetchMock)) as Record<string, unknown> & {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string; description: string } }>;
    };
    expect(body).toMatchObject({
      model: "test-model",
      stream: false,
      n: 1,
      tool_choice: "required",
      parallel_tool_calls: false,
    });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("reasoning");
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body.messages[0].content).toBe(researchAgentV1PromptDefinition.systemPrompt);
    expect(body.messages[0]?.content).not.toContain("bounded agents");
    expect(JSON.parse(body.messages[1].content)).toEqual(input().context);
    expect(body.tools.map((tool) => tool.function.name)).toEqual(actions.map((action) => action.name));
    expect(body.tools.map((tool) => tool.function.description)).toEqual(
      actions.map((action) => action.description),
    );
    expect(decision).toEqual({
      kind: "tool_call",
      toolName: "search_arxiv",
      arguments: { query: "agents", page: 1, pageSize: 5, sort: "relevance" },
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.kind === "tool_call" && Object.isFrozen(decision.arguments)).toBe(true);
  });

  it.each([
    ["search_knowledge_base", { query: "local evidence" }, { query: "local evidence", limit: 8 }],
    ["ask_knowledge", { query: "grounded answer" }, { query: "grounded answer" }],
  ] as const)("validates and normalizes a %s decision", async (name, raw, normalized) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope(name, raw))),
    );
    await expect(provider(fetchMock).decide(input())).resolves.toEqual({
      kind: "tool_call",
      toolName: name,
      arguments: normalized,
    });
  });

  it.each([
    {
      status: "answered",
      answer: "Bounded orchestration is supported. [E1]",
      evidenceIds: ["E1"],
    },
    {
      status: "insufficient_context",
      answer: "The supplied evidence is insufficient.",
      evidenceIds: [],
    },
  ] as const)("accepts a valid final-answer action", async (result) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope("submit_final_answer", result))),
    );
    const decision = await provider(fetchMock).decide(input());
    expect(decision).toEqual({ kind: "final_answer", result });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.kind === "final_answer" && Object.isFrozen(decision.result.evidenceIds))
      .toBe(true);
  });

  it.each([
    ["no choices", { choices: [] }],
    ["multiple choices", { choices: [{}, {}] }],
    ["plain text", { choices: [{ finish_reason: "stop", message: { content: "answer" } }] }],
    ["content plus call", toolCallEnvelope("search_arxiv", { query: "valid" }, {
      message: {
        role: "assistant",
        content: "I will search.",
        tool_calls: [{ id: "c", type: "function", function: { name: "search_arxiv", arguments: "{\"query\":\"valid\"}" } }],
      },
    })],
    ["refusal", toolCallEnvelope("search_arxiv", { query: "valid" }, {
      message: { role: "assistant", content: null, refusal: "No", tool_calls: [] },
    })],
    ["multiple calls", {
      choices: [{ finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [
          { id: "a", type: "function", function: { name: "search_arxiv", arguments: "{\"query\":\"valid\"}" } },
          { id: "b", type: "function", function: { name: "search_arxiv", arguments: "{\"query\":\"valid\"}" } },
        ],
      } }],
    }],
    ["extra function field", {
      choices: [{ finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [{
          id: "a", type: "function", function: {
            name: "search_arxiv", arguments: "{\"query\":\"valid\"}", invented: true,
          },
        }],
      } }],
    }],
  ])("rejects %s output", async (_label, envelope) => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(envelope)));
    expectSafeProviderError(
      await capturedError(provider(fetchMock).decide(input({ limits: { ...input().limits, maxAttempts: 1 } }))),
      "agent_provider_invalid_response",
    );
  });

  it.each([
    "unknown_tool",
    "Search_Arxiv",
    "search-arxiv",
    "search_knowledge_base",
  ])("rejects the unknown or unoffered action %s identically", async (name) => {
    const limitedActions = createAgentDecisionActions([descriptors[0]]);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope(name, { query: "valid" }))),
    );
    const error = await capturedError(
      provider(fetchMock).decide(input({ offeredActions: limitedActions })),
    );
    expectSafeProviderError(error, "agent_provider_invalid_response");
  });

  it.each([
    null,
    [],
    "string",
    { query: "x" },
    { query: "valid", unexpected: true },
  ])("rejects malformed or schema-invalid arguments", async (arguments_) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope("search_arxiv", arguments_))),
    );
    expectSafeProviderError(
      await capturedError(provider(fetchMock).decide(input())),
      "agent_provider_invalid_response",
    );
  });

  it("rejects malformed argument JSON and invalid final evidence markers", async () => {
    const malformed = toolCallEnvelope("search_arxiv", { query: "valid" });
    const call = malformed.choices[0].message.tool_calls[0];
    call.function.arguments = "{";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(malformed))
      .mockResolvedValueOnce(
        jsonResponse(toolCallEnvelope("submit_final_answer", {
          status: "answered",
          answer: "Unsupported marker [E2]",
          evidenceIds: ["E1"],
        })),
      );
    expectSafeProviderError(await capturedError(provider(fetchMock).decide(input())), "agent_provider_invalid_response");
    expectSafeProviderError(await capturedError(provider(fetchMock).decide(input())), "agent_provider_invalid_response");
  });

  it("fails unknown prompt versions and duplicate offered actions before transport", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    expectSafeProviderError(
      await capturedError(provider(fetchMock).decide(input({ promptVersion: "unknown" }))),
      "agent_provider_unavailable",
    );
    await expect(
      provider(fetchMock).decide(input({ offeredActions: [actions[0], actions[0]] })),
    ).rejects.toThrow("Duplicate Agent decision action name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", new Response("")],
    ["invalid UTF-8", new Response(new Uint8Array([0xff]))],
    ["malformed JSON", new Response("{")],
    ["malformed envelope", jsonResponse({ choices: "invalid" })],
  ])("rejects an %s response body", async (_label, response) => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
    expectSafeProviderError(
      await capturedError(provider(fetchMock).decide(input({ limits: { ...input().limits, maxAttempts: 1 } }))),
      "agent_provider_invalid_response",
    );
  });

  it("rejects declared and streamed response overflow", async () => {
    const declared = new Response("{}", { headers: { "content-length": "70000" } });
    const cancel = vi.fn(() => {
      throw new Error("cancel failure with secret response");
    });
    const streamed = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(20));
      },
      cancel,
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(declared)
      .mockResolvedValueOnce(streamed);
    const smallLimit = input({ limits: { timeoutMs: 1_000, maxAttempts: 1, responseMaxBytes: 10 } });
    expectSafeProviderError(await capturedError(provider(fetchMock).decide(smallLimit)), "agent_provider_invalid_response");
    expectSafeProviderError(await capturedError(provider(fetchMock).decide(smallLimit)), "agent_provider_invalid_response");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([429, 502, 503, 504])("retries HTTP %i once", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rejected secret", { status }))
      .mockResolvedValueOnce(jsonResponse(toolCallEnvelope("search_arxiv", { query: "valid" })));
    await expect(provider(fetchMock).decide(input())).resolves.toMatchObject({ kind: "tool_call" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once and caps attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new Error("transport secret")));
    const error = await capturedError(provider(fetchMock).decide(input()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectSafeProviderError(error, "agent_provider_unavailable");
    expect(String(error)).not.toContain("transport secret");
  });

  it.each([400, 401, 500])("does not retry rejected HTTP %i", async (status) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("provider body secret", { status })),
    );
    const error = await capturedError(provider(fetchMock).decide(input()));
    expect(fetchMock).toHaveBeenCalledOnce();
    expectSafeProviderError(error, "agent_provider_rejected");
    expect(String(error)).not.toContain("provider body secret");
  });

  it("retries an adapter timeout once and keeps timeout taxonomy", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Request aborted."));
        });
      }),
    );
    const decision = provider(fetchMock).decide(
      input({ limits: { timeoutMs: 10, maxAttempts: 2, responseMaxBytes: 65_536 } }),
    );
    const assertion = expect(decision).rejects.toMatchObject({ code: "agent_provider_timeout" });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation before and during transport", async () => {
    const beforeController = new AbortController();
    const beforeReason = new Error("caller stopped before request");
    beforeController.abort(beforeReason);
    const fetchMock = vi.fn<typeof fetch>();
    await expect(provider(fetchMock).decide(input({ signal: beforeController.signal }))).rejects.toBe(beforeReason);
    expect(fetchMock).not.toHaveBeenCalled();

    const duringController = new AbortController();
    const duringReason = Object.freeze({ code: "caller_cancelled" });
    const pendingFetch = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Request aborted."));
        });
      }),
    );
    const pending = provider(pendingFetch).decide(input({ signal: duringController.signal }));
    duringController.abort(duringReason);
    await expect(pending).rejects.toBe(duringReason);
    expect(pendingFetch).toHaveBeenCalledOnce();
  });

  it("preserves caller cancellation during response body read and cleans attempt resources", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = Object.freeze({ code: "caller_cancelled_during_body_read" });
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    let markBodyReadStarted!: () => void;
    const bodyReadStarted = new Promise<void>((resolve) => {
      markBodyReadStarted = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        start(streamController) {
          bodyController = streamController;
        },
        pull() {
          markBodyReadStarted();
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      init?.signal?.addEventListener(
        "abort",
        () => bodyController.error(new Error("Body read interrupted.")),
        { once: true },
      );
      return Promise.resolve(new Response(body));
    });

    const decision = provider(fetchMock).decide(input({ signal: controller.signal }));
    await bodyReadStarted;
    controller.abort(reason);

    await expect(decision).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls[0]?.[1]).toBe(addListener.mock.calls[0]?.[1]);
  });

  it("honors caller cancellation at the true retry boundary after a 503 classification", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("caller deadline reached");
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = controller.signal.removeEventListener.bind(controller.signal);
    const removeListener = vi
      .spyOn(controller.signal, "removeEventListener")
      .mockImplementation((type, listener, options) => {
        removeAbortListener(type, listener, options);
        if (type === "abort" && !controller.signal.aborted) controller.abort(reason);
      });
    const fetchMock = vi.fn<typeof fetch>(() => {
      return Promise.resolve(new Response("retryable", { status: 503 }));
    });

    await expect(
      provider(fetchMock).decide(input({ signal: controller.signal })),
    ).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls[0]?.[1]).toBe(addListener.mock.calls[0]?.[1]);
  });

  it("lets caller cancellation win the adapter-timeout race and cleans attempt resources", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("caller cancelled at timeout boundary");
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let callerWasAbortedWhenAttemptTimedOut: boolean | null = null;
    let attemptWasAborted = false;
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      const attemptSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        attemptSignal?.addEventListener(
          "abort",
          () => {
            attemptWasAborted = attemptSignal.aborted;
            callerWasAbortedWhenAttemptTimedOut = controller.signal.aborted;
            controller.abort(reason);
            reject(new Error("Attempt interrupted by timeout."));
          },
          { once: true },
        );
      });
    });
    const decision = provider(fetchMock).decide(
      input({
        signal: controller.signal,
        limits: { timeoutMs: 10, maxAttempts: 2, responseMaxBytes: 65_536 },
      }),
    );
    const assertion = expect(decision).rejects.toBe(reason);

    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    expect(callerWasAbortedWhenAttemptTimedOut).toBe(false);
    expect(attemptWasAborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls[0]?.[1]).toBe(addListener.mock.calls[0]?.[1]);
  });

  it("removes its caller abort listener after a successful attempt", async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(toolCallEnvelope("search_arxiv", { query: "valid" }))),
    );

    await provider(fetchMock).decide(input({ signal: controller.signal }));
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls[0]?.[0]).toBe("abort");
    expect(removeListener.mock.calls[0]?.[1]).toBe(addListener.mock.calls[0]?.[1]);
  });

  it("does not leak credentials, request data, response bodies, or raw errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("secret-api-key bounded agents raw response", { status: 400 })),
    );
    const error = await capturedError(provider(fetchMock).decide(input()));
    const serialized = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("bounded agents");
    expect(serialized).not.toContain("raw response");
    expect(serialized).not.toContain("Authorization");
  });

  it.each([
    { timeoutMs: 0, maxAttempts: 1 as const, responseMaxBytes: 1 },
    { timeoutMs: 30_001, maxAttempts: 1 as const, responseMaxBytes: 1 },
    { timeoutMs: 1, maxAttempts: 2 as const, responseMaxBytes: 65_537 },
  ])("rejects out-of-range limits before transport", async (limits) => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(provider(fetchMock).decide(input({ limits }))).rejects.toThrow(
      "Invalid Agent decision provider input",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unordered context and duplicate run-local evidence before transport", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const base = input().context.completedToolCalls[0];
    await expect(
      provider(fetchMock).decide(input({
        context: {
          taskPrompt: "Validate context.",
          completedToolCalls: [base, { ...base, toolName: "ask_knowledge" }],
        },
      })),
    ).rejects.toThrow("Invalid Agent decision provider input");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept a logging dependency", () => {
    expect(
      Object.getOwnPropertyNames(
        new OpenAICompatibleAgentDecisionProvider({
          baseUrl: "https://provider.example",
          apiKey: "key",
          model: "model",
        }),
      ),
    ).not.toContain("logger");
    expect(() =>
      new OpenAICompatibleAgentDecisionProvider({
        baseUrl: " ", apiKey: "key", model: "model",
      }),
    ).toThrow(TypeError);
  });
});
