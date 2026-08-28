import { z } from "zod";

import {
  researchSummaryContentSchema,
  type ResearchSummaryContent,
} from "../../../shared/contracts/research";
import type { PaperSummarySource } from "../../modules/research/summary-fingerprint";
import {
  isResearchSummaryGeneratorError,
  ResearchSummaryGeneratorError,
} from "./errors";
import type { ResearchSummaryGenerator } from "./generator";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

const providerResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const SYSTEM_PROMPT = `You generate an abstract-grounded research paper summary.
Use only the supplied paper metadata and abstract.
Do not claim access to the full paper.
Do not infer or invent unsupported datasets, metrics, experimental results, architectural details, implementation details, benchmarks, limitations, citations, or comparisons.
Return only one JSON object, without Markdown, code fences, or additional explanation, with exactly this shape:
{"overview":"...","keyContributions":[],"methodHighlights":[],"findings":[],"caveats":[]}
If the abstract does not support a section, return an empty array.
Caveats may contain only limitations, scope restrictions, constraints, boundaries, or uncertainty explicitly supported by the abstract.`;

interface OpenAICompatibleGeneratorOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: 1 | 2;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

async function discardBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response is intentionally discarded and cancellation errors are not actionable.
  }
}

export class OpenAICompatibleResearchSummaryGenerator implements ResearchSummaryGenerator {
  readonly model: string;
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: 1 | 2;
  private readonly setTimer: NonNullable<OpenAICompatibleGeneratorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<OpenAICompatibleGeneratorOptions["clearTimer"]>;

  constructor({
    baseUrl,
    apiKey,
    model,
    fetchFn = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer = (timer) => clearTimeout(timer),
  }: OpenAICompatibleGeneratorOptions) {
    if (timeoutMs <= 0) throw new TypeError("Summary generator timeout must be positive.");
    this.endpoint = new URL(`${baseUrl.replace(/\/+$/u, "")}/chat/completions`);
    this.apiKey = apiKey;
    this.model = model;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async generate(source: PaperSummarySource): Promise<ResearchSummaryContent> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.attempt(source);
      } catch (error: unknown) {
        if (
          attempt >= this.maxAttempts ||
          !isResearchSummaryGeneratorError(error) ||
          !error.retryable
        ) {
          throw error;
        }
      }
    }
    throw new ResearchSummaryGeneratorError(
      "SUMMARY_UPSTREAM_FAILURE",
      "The summary provider request failed.",
    );
  }

  private async attempt(source: PaperSummarySource): Promise<ResearchSummaryContent> {
    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                title: source.title,
                abstract: source.abstract,
                authors: source.authors,
                primaryCategory: source.primaryCategory,
                categories: source.categories,
                versionedArxivId: source.versionedArxivId,
                version: source.version,
                publishedAt: source.publishedAt.toISOString(),
                updatedAt: source.updatedAt.toISOString(),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = TRANSIENT_HTTP_STATUSES.has(response.status);
        await discardBody(response);
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_UPSTREAM_FAILURE",
          "The summary provider returned an unsuccessful response.",
          { retryable },
        );
      }

      let providerPayload: unknown;
      try {
        providerPayload = await response.json();
      } catch (error: unknown) {
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_INVALID_RESPONSE",
          "The summary provider returned invalid JSON.",
          { cause: error },
        );
      }

      const parsedProvider = providerResponseSchema.safeParse(providerPayload);
      const content = parsedProvider.success ? parsedProvider.data.choices[0]?.message.content : undefined;
      if (!content?.trim()) {
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_INVALID_RESPONSE",
          "The summary provider response did not contain content.",
        );
      }

      let summaryPayload: unknown;
      try {
        summaryPayload = JSON.parse(content);
      } catch (error: unknown) {
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_INVALID_RESPONSE",
          "The generated summary was not valid JSON.",
          { cause: error },
        );
      }
      const summary = researchSummaryContentSchema.safeParse(summaryPayload);
      if (!summary.success) {
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_INVALID_RESPONSE",
          "The generated summary did not match the required structure.",
        );
      }
      return summary.data;
    } catch (error: unknown) {
      if (isResearchSummaryGeneratorError(error)) throw error;
      if (controller.signal.aborted) {
        throw new ResearchSummaryGeneratorError(
          "SUMMARY_UPSTREAM_TIMEOUT",
          "The summary provider request timed out.",
          { retryable: true, cause: error },
        );
      }
      throw new ResearchSummaryGeneratorError(
        "SUMMARY_UPSTREAM_FAILURE",
        "The summary provider request failed.",
        { retryable: true, cause: error },
      );
    } finally {
      this.clearTimer(timer);
    }
  }
}
