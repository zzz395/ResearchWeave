import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingError,
  EMBEDDING_BATCH_SIZE,
  type DocumentEmbeddingGenerator,
  type GeneratedEmbeddings,
} from "../../modules/documents/document-embedding-generator";

export const MAX_EMBEDDING_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

interface OpenAICompatibleDocumentEmbeddingGeneratorOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: 1 | 2;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider error bodies are deliberately discarded and never exposed.
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new DocumentEmbeddingError("document_embedding_invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_EMBEDDING_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains the stable failure even if cancellation also fails.
        }
        throw new DocumentEmbeddingError("document_embedding_invalid_response");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new DocumentEmbeddingError("document_embedding_invalid_response", { cause: error });
  }
}

function validateBatch(payload: unknown, expectedCount: number): number[][] {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    throw new DocumentEmbeddingError("document_embedding_invalid_response");
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new DocumentEmbeddingError("document_embedding_invalid_response");
  }

  const ordered: Array<number[] | undefined> = Array.from({ length: expectedCount });
  for (const item of data) {
    if (typeof item !== "object" || item === null) {
      throw new DocumentEmbeddingError("document_embedding_invalid_response");
    }
    const { index, embedding } = item as { index?: unknown; embedding?: unknown };
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= expectedCount) {
      throw new DocumentEmbeddingError("document_embedding_invalid_response");
    }
    const position = index as number;
    if (ordered[position] !== undefined || !Array.isArray(embedding)) {
      throw new DocumentEmbeddingError("document_embedding_invalid_response");
    }
    if (
      embedding.length !== DOCUMENT_EMBEDDING_DIMENSIONS ||
      embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new DocumentEmbeddingError("document_embedding_invalid_response");
    }
    ordered[position] = embedding as number[];
  }
  if (ordered.some((embedding) => embedding === undefined)) {
    throw new DocumentEmbeddingError("document_embedding_invalid_response");
  }
  return ordered as number[][];
}

export class OpenAICompatibleDocumentEmbeddingGenerator
  implements DocumentEmbeddingGenerator
{
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: 1 | 2;
  private readonly setTimer: NonNullable<
    OpenAICompatibleDocumentEmbeddingGeneratorOptions["setTimer"]
  >;
  private readonly clearTimer: NonNullable<
    OpenAICompatibleDocumentEmbeddingGeneratorOptions["clearTimer"]
  >;

  constructor({
    baseUrl,
    apiKey,
    fetchFn = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer = (timer) => clearTimeout(timer),
  }: OpenAICompatibleDocumentEmbeddingGeneratorOptions) {
    if (timeoutMs <= 0) throw new TypeError("Embedding generator timeout must be positive.");
    this.endpoint = new URL(`${baseUrl.replace(/\/+$/u, "")}/embeddings`);
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async embed({ texts }: { texts: string[] }): Promise<GeneratedEmbeddings> {
    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      embeddings.push(...(await this.embedBatch(batch)));
    }
    return {
      model: DOCUMENT_EMBEDDING_MODEL,
      dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
      embeddings,
    };
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.attemptBatch(texts);
      } catch (error: unknown) {
        if (
          attempt >= this.maxAttempts ||
          !(error instanceof DocumentEmbeddingError) ||
          !error.retryable
        ) {
          throw error;
        }
      }
    }
    throw new DocumentEmbeddingError("document_embedding_unavailable");
  }

  private async attemptBatch(texts: string[]): Promise<number[][]> {
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
          model: DOCUMENT_EMBEDDING_MODEL,
          input: texts,
          encoding_format: "float",
          dimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
        await discardBody(response);
        if (response.status >= 400 && response.status < 500 && !retryable) {
          throw new DocumentEmbeddingError("document_embedding_rejected");
        }
        throw new DocumentEmbeddingError("document_embedding_unavailable", { retryable });
      }
      return validateBatch(await readBoundedJson(response), texts.length);
    } catch (error: unknown) {
      if (error instanceof DocumentEmbeddingError) throw error;
      throw new DocumentEmbeddingError("document_embedding_unavailable", {
        retryable: true,
        cause: error,
      });
    } finally {
      this.clearTimer(timer);
    }
  }
}
