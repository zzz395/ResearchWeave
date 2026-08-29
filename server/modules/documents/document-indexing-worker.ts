import type { Logger } from "pino";

import type { DocumentStorage } from "../../integrations/document-storage/storage";
import type { DocumentChunker } from "./document-chunker";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingError,
  type DocumentEmbeddingGenerator,
  type GeneratedEmbeddings,
} from "./document-embedding-generator";
import { createDocumentIndexFingerprint } from "./document-index-fingerprint";
import {
  DocumentIngestionError,
  isDocumentIngestionError,
  type DocumentIngestionErrorCode,
} from "./document-ingestion-errors";
import type { DocumentTextExtractor } from "./document-text-extractor";
import type { DocumentIndexingClaim, DocumentRepository } from "./repository";
import type { DocumentStage } from "../../../shared/contracts/documents";

const DEFAULT_IDLE_POLL_MS = 2_000;

class StaleDocumentAttemptError extends Error {
  constructor() {
    super("Document indexing attempt is no longer current.");
    this.name = "StaleDocumentAttemptError";
  }
}

export interface DocumentIndexingWorkerOptions {
  repository: Pick<
    DocumentRepository,
    | "recoverProcessingDocuments"
    | "claimNextQueuedDocument"
    | "updateProcessingStage"
    | "markIndexingFailed"
    | "activateDocumentIndex"
  >;
  storage: Pick<DocumentStorage, "readSource">;
  extractor: DocumentTextExtractor;
  chunker: DocumentChunker;
  embeddingGenerator: DocumentEmbeddingGenerator;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  idlePollMs?: number;
}

export class DocumentIndexingWorker {
  private readonly repository: DocumentIndexingWorkerOptions["repository"];
  private readonly storage: DocumentIndexingWorkerOptions["storage"];
  private readonly extractor: DocumentTextExtractor;
  private readonly chunker: DocumentChunker;
  private readonly embeddingGenerator: DocumentEmbeddingGenerator;
  private readonly logger: DocumentIndexingWorkerOptions["logger"];
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly idlePollMs: number;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private activeIteration: Promise<boolean> | null = null;

  constructor({
    repository,
    storage,
    extractor,
    chunker,
    embeddingGenerator,
    logger,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    idlePollMs = DEFAULT_IDLE_POLL_MS,
  }: DocumentIndexingWorkerOptions) {
    if (idlePollMs < 0) throw new TypeError("Document worker poll interval cannot be negative.");
    this.repository = repository;
    this.storage = storage;
    this.extractor = extractor;
    this.chunker = chunker;
    this.embeddingGenerator = embeddingGenerator;
    this.logger = logger;
    this.now = now;
    this.sleep = sleep;
    this.idlePollMs = idlePollMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const recovered = await this.repository.recoverProcessingDocuments(this.now());
    this.logger.info({ recovered }, "document indexing recovery completed");
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
  }

  processNext(): Promise<boolean> {
    if (this.activeIteration) return this.activeIteration;
    this.activeIteration = this.claimAndProcess().finally(() => {
      this.activeIteration = null;
    });
    return this.activeIteration;
  }

  private async claimAndProcess(): Promise<boolean> {
    const claim = await this.repository.claimNextQueuedDocument(this.now());
    if (!claim) return false;
    await this.processClaim(claim);
    return true;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        if (await this.processNext()) continue;
      } catch (error: unknown) {
        this.logger.error(
          { errorType: error instanceof Error ? error.name : "UnknownError" },
          "document indexing worker iteration failed",
        );
      }
      if (this.running) await this.sleep(this.idlePollMs);
    }
  }

  private async processClaim(claim: DocumentIndexingClaim): Promise<void> {
    let stage: DocumentStage = "extracting";
    try {
      let bytes: Uint8Array;
      try {
        bytes = await this.storage.readSource(claim.storageKey);
      } catch {
        throw new DocumentIngestionError("document_source_unavailable");
      }
      const extracted = await this.extractor.extract({ mediaType: claim.mediaType, bytes });

      stage = "chunking";
      await this.requireStageOwnership(claim, stage);
      const chunked = this.chunker.chunk(extracted);
      if (chunked.chunks.length === 0) {
        throw new DocumentIngestionError("document_no_indexable_text");
      }

      stage = "embedding";
      await this.requireStageOwnership(claim, stage);
      const generated = await this.embeddingGenerator.embed({
        texts: chunked.chunks.map((chunk) => chunk.content),
      });
      this.validateGeneratedEmbeddings(generated, chunked.chunks.length);
      const indexFingerprint = createDocumentIndexFingerprint({
        sourceSha256: claim.sourceSha256,
        mediaType: claim.mediaType,
        extractorVersion: extracted.extractorVersion,
        chunkerVersion: chunked.chunkerVersion,
        embeddingModel: generated.model,
        embeddingDimensions: generated.dimensions,
        chunks: chunked.chunks,
      });

      let activation;
      try {
        activation = await this.repository.activateDocumentIndex(
          {
            documentId: claim.documentId,
            attemptNumber: claim.attemptNumber,
            pageCount: extracted.pageCount,
            characterCount: extracted.characterCount,
            extractorVersion: extracted.extractorVersion,
            chunkerVersion: chunked.chunkerVersion,
            embeddingModel: generated.model,
            embeddingDimensions: generated.dimensions,
            indexFingerprint,
            chunks: chunked.chunks.map((chunk, index) => ({
              ...chunk,
              embedding: generated.embeddings[index],
            })),
          },
          this.now(),
        );
      } catch (error: unknown) {
        await this.failClaim(claim, stage, "document_index_persistence_failed");
        this.logger.warn(
          {
            documentId: claim.documentId,
            attemptNumber: claim.attemptNumber,
            stage,
            errorCode: "document_index_persistence_failed",
            errorType: error instanceof Error ? error.name : "UnknownError",
          },
          "document index activation failed",
        );
        return;
      }
      if (activation.status === "stale") return;
      this.logger.info(
        {
          documentId: claim.documentId,
          attemptNumber: claim.attemptNumber,
          chunkCount: chunked.chunks.length,
        },
        "document index activated",
      );
    } catch (error: unknown) {
      if (error instanceof StaleDocumentAttemptError) return;
      const errorCode = this.errorCodeFor(error, stage);
      await this.failClaim(claim, stage, errorCode);
      this.logger.warn(
        {
          documentId: claim.documentId,
          attemptNumber: claim.attemptNumber,
          stage,
          errorCode,
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
        "document indexing attempt failed",
      );
    }
  }

  private async requireStageOwnership(
    claim: DocumentIndexingClaim,
    stage: DocumentStage,
  ): Promise<void> {
    const updated = await this.repository.updateProcessingStage(
      claim.documentId,
      claim.attemptNumber,
      stage,
      this.now(),
    );
    if (!updated) throw new StaleDocumentAttemptError();
  }

  private validateGeneratedEmbeddings(generated: GeneratedEmbeddings, expectedCount: number): void {
    if (
      generated.model !== DOCUMENT_EMBEDDING_MODEL ||
      generated.dimensions !== DOCUMENT_EMBEDDING_DIMENSIONS ||
      generated.embeddings.length !== expectedCount
    ) {
      throw new DocumentEmbeddingError("document_embedding_invalid_response");
    }
    for (let index = 0; index < generated.embeddings.length; index += 1) {
      const embedding: unknown = generated.embeddings[index];
      if (
        !Array.isArray(embedding) ||
        embedding.length !== DOCUMENT_EMBEDDING_DIMENSIONS ||
        embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new DocumentEmbeddingError("document_embedding_invalid_response");
      }
    }
  }

  private errorCodeFor(error: unknown, stage: DocumentStage): DocumentIngestionErrorCode {
    if (isDocumentIngestionError(error)) return error.code;
    if (stage === "embedding") return "document_embedding_unavailable";
    return "document_pdf_extraction_failed";
  }

  private async failClaim(
    claim: DocumentIndexingClaim,
    stage: DocumentStage,
    errorCode: DocumentIngestionErrorCode,
  ): Promise<void> {
    try {
      await this.repository.markIndexingFailed(
        claim.documentId,
        claim.attemptNumber,
        stage,
        errorCode,
        this.now(),
      );
    } catch (error: unknown) {
      this.logger.error(
        {
          documentId: claim.documentId,
          attemptNumber: claim.attemptNumber,
          stage,
          errorCode,
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
        "document indexing failure state could not be persisted",
      );
    }
  }
}
