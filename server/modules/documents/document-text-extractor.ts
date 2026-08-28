import type { DocumentMediaType } from "../../../shared/contracts/documents";

export const MAX_PDF_PAGES = 500;
export const MAX_NORMALIZED_CHARS = 2_000_000;
export const PDF_MAX_IMAGE_SIZE = 16_777_216;

export interface ExtractedTextUnit {
  pageNumber: number | null;
  text: string;
}

export interface ExtractedDocument {
  mediaType: DocumentMediaType;
  extractorVersion: string;
  pageCount: number | null;
  characterCount: number;
  units: ExtractedTextUnit[];
}

export interface DocumentTextExtractor {
  extract(input: {
    mediaType: DocumentMediaType;
    bytes: Uint8Array;
  }): Promise<ExtractedDocument>;
}
