export type DocumentIngestionErrorCode =
  | "document_invalid_utf8"
  | "document_pdf_invalid"
  | "document_pdf_password_protected"
  | "document_pdf_page_limit_exceeded"
  | "document_text_limit_exceeded"
  | "document_no_extractable_text"
  | "document_chunk_limit_exceeded"
  | "document_pdf_extraction_failed"
  | "document_source_unavailable"
  | "document_no_indexable_text"
  | "document_embedding_unconfigured"
  | "document_embedding_unavailable"
  | "document_embedding_rejected"
  | "document_embedding_invalid_response"
  | "document_index_persistence_failed";

const messages: Record<DocumentIngestionErrorCode, string> = {
  document_invalid_utf8: "The document is not valid UTF-8.",
  document_pdf_invalid: "The PDF document is invalid.",
  document_pdf_password_protected: "The PDF document is password-protected.",
  document_pdf_page_limit_exceeded: "The PDF document exceeds the page limit.",
  document_text_limit_exceeded: "The document exceeds the normalized text limit.",
  document_no_extractable_text: "The PDF document has no extractable text.",
  document_chunk_limit_exceeded: "The document exceeds the chunk limit.",
  document_pdf_extraction_failed: "PDF text extraction failed.",
  document_source_unavailable: "The durable document source is unavailable.",
  document_no_indexable_text: "The document has no indexable text.",
  document_embedding_unconfigured: "Document embeddings are not configured.",
  document_embedding_unavailable: "The document embedding provider is unavailable.",
  document_embedding_rejected: "The document embedding provider rejected the request.",
  document_embedding_invalid_response: "The document embedding provider returned an invalid response.",
  document_index_persistence_failed: "The document index could not be activated.",
};

export class DocumentIngestionError extends Error {
  readonly code: DocumentIngestionErrorCode;

  constructor(code: DocumentIngestionErrorCode) {
    super(messages[code]);
    this.name = "DocumentIngestionError";
    this.code = code;
  }
}

export function isDocumentIngestionError(error: unknown): error is DocumentIngestionError {
  return error instanceof DocumentIngestionError;
}
