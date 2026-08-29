import type { DocumentTextExtractor } from "../../modules/documents/document-text-extractor";
import type { PdfDocumentLoader } from "./pdf-document-text-extractor";
import { extractPdfText } from "./pdf-document-text-extractor";
import { extractSourceText } from "./source-text-extractor";

export function createDocumentTextExtractor(pdfLoader?: PdfDocumentLoader): DocumentTextExtractor {
  return {
    async extract(input) {
      if (input.mediaType === "pdf") return extractPdfText(input.bytes, pdfLoader);
      return extractSourceText(input.mediaType, input.bytes);
    },
  };
}
