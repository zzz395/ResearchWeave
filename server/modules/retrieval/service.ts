import type {
  SemanticRetrievalRequest,
  SemanticRetrievalResponse,
} from "../../../shared/contracts/retrieval";
import { AppError } from "../../middleware/app-error";
import {
  DocumentEmbeddingError,
  type DocumentEmbeddingGenerator,
  type GeneratedEmbeddings,
} from "../documents/document-embedding-generator";
import type { SemanticRetrievalRepository } from "./repository";

export interface SemanticRetrievalService {
  retrieve(
    spaceId: string,
    actorId: string,
    input: SemanticRetrievalRequest,
  ): Promise<SemanticRetrievalResponse>;
}

function embeddingErrorToAppError(error: DocumentEmbeddingError): AppError {
  switch (error.code) {
    case "document_embedding_unconfigured":
      return new AppError(
        503,
        "retrieval_embedding_unconfigured",
        "Semantic retrieval is not configured.",
      );
    case "document_embedding_rejected":
      return new AppError(
        502,
        "retrieval_embedding_rejected",
        "The embedding provider rejected the retrieval query.",
      );
    case "document_embedding_invalid_response":
      return invalidEmbeddingResponse();
    case "document_embedding_unavailable":
      return new AppError(
        503,
        "retrieval_embedding_unavailable",
        "The embedding provider is unavailable.",
      );
    default:
      return new AppError(
        503,
        "retrieval_embedding_unavailable",
        "The embedding provider is unavailable.",
      );
  }
}

function invalidEmbeddingResponse(): AppError {
  return new AppError(
    502,
    "retrieval_embedding_invalid_response",
    "The embedding provider returned an invalid response.",
  );
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is number =>
      typeof item === "number" && Number.isFinite(item),
    )
  );
}

function validateQueryEmbedding(generated: GeneratedEmbeddings): {
  model: string;
  dimensions: number;
  embedding: number[];
} {
  const embedding: unknown = generated.embeddings[0];
  if (
    typeof generated.model !== "string" ||
    generated.model.trim().length === 0 ||
    !Number.isInteger(generated.dimensions) ||
    generated.dimensions <= 0 ||
    generated.embeddings.length !== 1 ||
    !isFiniteNumberArray(embedding) ||
    embedding.length !== generated.dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw invalidEmbeddingResponse();
  }
  return {
    model: generated.model,
    dimensions: generated.dimensions,
    embedding,
  };
}

export function createSemanticRetrievalService(
  repository: SemanticRetrievalRepository,
  embeddingGenerator: DocumentEmbeddingGenerator,
): SemanticRetrievalService {
  return {
    async retrieve(spaceId, actorId, input) {
      if (!(await repository.hasMembership(spaceId, actorId))) {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }

      let generated: GeneratedEmbeddings;
      try {
        generated = await embeddingGenerator.embed({ texts: [input.query] });
      } catch (error: unknown) {
        if (error instanceof DocumentEmbeddingError) throw embeddingErrorToAppError(error);
        throw error;
      }
      const queryEmbedding = validateQueryEmbedding(generated);
      const result = await repository.searchForMember({
        spaceId,
        actorId,
        embedding: queryEmbedding.embedding,
        embeddingModel: queryEmbedding.model,
        embeddingDimensions: queryEmbedding.dimensions,
        limit: input.limit,
      });
      if (result.status === "space_not_found") {
        throw new AppError(404, "space_not_found", "Research space was not found.");
      }
      if (result.status === "knowledge_not_indexed") {
        throw new AppError(
          409,
          "knowledge_not_indexed",
          "The knowledge base has no active index. Index at least one document before searching.",
        );
      }
      if (result.status === "knowledge_embedding_incompatible") {
        throw new AppError(
          409,
          "knowledge_embedding_incompatible",
          "The active knowledge index is incompatible with the current embedding configuration. Reindex the knowledge base before searching.",
        );
      }
      return { results: result.records };
    },
  };
}
