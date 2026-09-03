import type {
  Document,
  DocumentMediaType,
  DocumentStage,
} from "../../../shared/contracts/documents";

type PresentedDocument = Pick<Document, "status" | "stage" | "indexedAt">;

export type DocumentStatusTone = "neutral" | "active" | "success" | "danger";

export interface DocumentStatusPresentation {
  primary: string;
  secondary: string;
  tone: DocumentStatusTone;
}

export interface ActiveIndexPresentation {
  available: boolean;
  label: string;
  detail: string;
}

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  document_invalid_utf8: "This text file is not valid UTF-8.",
  document_pdf_invalid: "This PDF could not be read.",
  document_pdf_password_protected: "Password-protected PDFs are not supported.",
  document_pdf_page_limit_exceeded: "This PDF exceeds the 500-page limit.",
  document_text_limit_exceeded: "This document is too large to index.",
  document_no_extractable_text: "No extractable text was found in this PDF.",
  document_chunk_limit_exceeded: "This document produces too many index chunks.",
  document_pdf_extraction_failed: "This PDF could not be processed.",
  document_source_unavailable: "The original document file is unavailable.",
  document_no_indexable_text: "No indexable text was found.",
  document_embedding_unconfigured: "Document indexing is not configured on this server.",
  document_embedding_unavailable: "The indexing service is temporarily unavailable.",
  document_embedding_rejected: "The indexing service rejected this document.",
  document_embedding_invalid_response: "The indexing service returned an invalid response.",
  document_index_persistence_failed: "The generated index could not be saved.",
};

const stageLabels: Record<DocumentStage, string> = {
  extracting: "Extracting",
  chunking: "Chunking",
  embedding: "Embedding",
};

export function getDocumentStageLabel(stage: DocumentStage | null): string {
  return stage ? stageLabels[stage] : "Not active";
}

export function getDocumentStatusPresentation(
  document: PresentedDocument,
): DocumentStatusPresentation {
  if (document.status === "queued") {
    return {
      primary: "Queued",
      secondary: document.indexedAt ? "Waiting to rebuild" : "Waiting to be indexed",
      tone: "neutral",
    };
  }
  if (document.status === "processing") {
    if (document.indexedAt) {
      const stage = document.stage ? stageLabels[document.stage].toLowerCase() : "processing";
      return { primary: "Reindexing", secondary: `${stage} replacement index`, tone: "active" };
    }
    if (document.stage === "extracting") {
      return { primary: "Extracting", secondary: "Reading document text", tone: "active" };
    }
    if (document.stage === "chunking") {
      return { primary: "Chunking", secondary: "Preparing knowledge units", tone: "active" };
    }
    return { primary: "Indexing", secondary: "Generating document index", tone: "active" };
  }
  if (document.status === "ready") {
    return { primary: "Ready", secondary: "Indexing complete", tone: "success" };
  }
  return document.indexedAt
    ? { primary: "Reindex failed", secondary: "Previous index is still active", tone: "danger" }
    : { primary: "Indexing failed", secondary: "Retry is available", tone: "danger" };
}

export function getActiveIndexPresentation(
  document: PresentedDocument,
): ActiveIndexPresentation {
  if (!document.indexedAt) {
    return document.status === "failed"
      ? { available: false, label: "No active index", detail: "Indexing did not complete" }
      : { available: false, label: "No active index yet", detail: "Available after first indexing" };
  }
  if (document.status === "processing" || document.status === "queued") {
    return {
      available: true,
      label: "Current index remains available",
      detail: "A replacement is being prepared",
    };
  }
  if (document.status === "failed") {
    return {
      available: true,
      label: "Previous index remains available",
      detail: "The latest rebuild did not replace it",
    };
  }
  return { available: true, label: "Indexed", detail: "Active knowledge is available" };
}

export function getDocumentSummary(documents: readonly Document[]) {
  return {
    total: documents.length,
    indexed: documents.filter((document) => document.indexedAt !== null).length,
    processing: documents.filter(
      (document) => document.status === "queued" || document.status === "processing",
    ).length,
    failed: documents.filter((document) => document.status === "failed").length,
  };
}

export function isTrueZeroDocumentList(
  documents: readonly Document[],
  nextCursor: string | null | undefined,
): boolean {
  return documents.length === 0 && nextCursor === null;
}

export function shouldPollDocuments(
  documents: ReadonlyArray<Pick<Document, "status">>,
): boolean {
  return documents.some(
    (document) => document.status === "queued" || document.status === "processing",
  );
}

export function getDocumentFailureMessage(errorCode: string | null): string | null {
  if (errorCode === null) return null;
  return FAILURE_MESSAGES[errorCode] ?? "Document indexing failed. Please try again.";
}

export function getReindexActionLabel(
  status: Document["status"],
): "Retry indexing" | "Reindex" | null {
  if (status === "failed") return "Retry indexing";
  if (status === "ready") return "Reindex";
  return null;
}

export function getDocumentMediaTypeLabel(mediaType: DocumentMediaType): string {
  return { pdf: "PDF", text: "Text", markdown: "Markdown" }[mediaType];
}

export function canManageDocument(
  document: Pick<Document, "uploadedByUserId">,
  spaceRole: "owner" | "member",
  currentUserId: string | undefined,
): boolean {
  return spaceRole === "owner"
    || (document.uploadedByUserId !== null && document.uploadedByUserId === currentUserId);
}

export const DOCUMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function validateDocumentFile(file: Pick<File, "name" | "size">): string | null {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
  if (!extension || ![".pdf", ".txt", ".md", ".markdown"].includes(extension)) {
    return "Choose a PDF, TXT, MD, or Markdown file.";
  }
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    return "Choose a document no larger than 20 MB.";
  }
  if (file.size === 0) return "Choose a non-empty document.";
  return null;
}
