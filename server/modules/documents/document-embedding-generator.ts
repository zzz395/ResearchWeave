import { DocumentIngestionError, type DocumentIngestionErrorCode } from "./document-ingestion-errors";

export const DOCUMENT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DOCUMENT_EMBEDDING_DIMENSIONS = 1536 as const;
export const EMBEDDING_BATCH_SIZE = 32;

export interface GeneratedEmbeddings {
  model: string;
  dimensions: typeof DOCUMENT_EMBEDDING_DIMENSIONS;
  embeddings: number[][];
}

export interface DocumentEmbeddingGenerator {
  embed(input: { texts: string[] }): Promise<GeneratedEmbeddings>;
}

export type DocumentEmbeddingErrorCode = Extract<
  DocumentIngestionErrorCode,
  | "document_embedding_unconfigured"
  | "document_embedding_unavailable"
  | "document_embedding_rejected"
  | "document_embedding_invalid_response"
>;

export class DocumentEmbeddingError extends DocumentIngestionError {
  readonly retryable: boolean;

  constructor(
    code: DocumentEmbeddingErrorCode,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(code);
    this.name = "DocumentEmbeddingError";
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class UnconfiguredDocumentEmbeddingGenerator implements DocumentEmbeddingGenerator {
  embed(): Promise<GeneratedEmbeddings> {
    return Promise.reject(new DocumentEmbeddingError("document_embedding_unconfigured"));
  }
}
