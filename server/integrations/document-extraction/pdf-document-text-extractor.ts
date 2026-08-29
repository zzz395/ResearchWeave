import { getResolvedPDFJS } from "unpdf";

import { DocumentIngestionError } from "../../modules/documents/document-ingestion-errors";
import {
  MAX_NORMALIZED_CHARS,
  MAX_PDF_PAGES,
  PDF_MAX_IMAGE_SIZE,
  type ExtractedDocument,
  type ExtractedTextUnit,
} from "../../modules/documents/document-text-extractor";

export const PDF_TEXT_EXTRACTOR_VERSION = "pdf-unpdf-v1";

export interface PdfTextContent {
  items: unknown[];
}

export interface PdfPageHandle {
  getTextContent(): Promise<PdfTextContent>;
}

export interface PdfDocumentHandle {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageHandle>;
}

export interface PdfDocumentLoadHandle {
  getDocument(): Promise<PdfDocumentHandle>;
  destroy(): Promise<void>;
}

export interface PdfDocumentLoader {
  start(bytes: Uint8Array, options: { maxImageSize: number }): Promise<PdfDocumentLoadHandle>;
}

const unpdfDocumentLoader: PdfDocumentLoader = {
  async start(bytes, options) {
    const { getDocument } = await getResolvedPDFJS();
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      maxImageSize: options.maxImageSize,
    });
    return {
      async getDocument() {
        const proxy = await loadingTask.promise;
        return {
          numPages: proxy.numPages,
          async getPage(pageNumber) {
            const page = await proxy.getPage(pageNumber);
            return {
              async getTextContent() {
                const content = await page.getTextContent();
                return { items: content.items };
              },
            };
          },
        };
      },
      async destroy() {
        await loadingTask.destroy();
      },
    };
  },
};

function isTextItem(item: unknown): item is { str: string; hasEOL?: boolean } {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}

export function rawTextFromPdfItems(items: unknown[]): string {
  let text = "";
  for (const item of items) {
    if (!isTextItem(item)) continue;
    text += item.str;
    if (item.hasEOL === true) text += "\n";
  }
  return text;
}

export function normalizePdfPageText(rawText: string): string {
  const normalized = rawText
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .normalize("NFC")
    .replace(/\u00A0/gu, " ")
    .replace(/\u00AD/gu, "")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .split("\n\n")
    .map((paragraph) => paragraph.replace(/\n/gu, " "))
    .join("\n\n");
  return normalized.trim();
}

function parserErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

function mapPdfError(error: unknown): DocumentIngestionError {
  if (error instanceof DocumentIngestionError) return error;
  const name = parserErrorName(error);
  if (name === "PasswordException") {
    return new DocumentIngestionError("document_pdf_password_protected");
  }
  if (
    name === "InvalidPDFException" ||
    name === "MissingPDFException" ||
    name === "FormatError"
  ) {
    return new DocumentIngestionError("document_pdf_invalid");
  }
  return new DocumentIngestionError("document_pdf_extraction_failed");
}

export async function extractPdfText(
  bytes: Uint8Array,
  loader: PdfDocumentLoader = unpdfDocumentLoader,
): Promise<ExtractedDocument> {
  let loadHandle: PdfDocumentLoadHandle | undefined;
  let document: PdfDocumentHandle | undefined;
  let result: ExtractedDocument | undefined;
  let failure: DocumentIngestionError | undefined;
  try {
    loadHandle = await loader.start(bytes, { maxImageSize: PDF_MAX_IMAGE_SIZE });
    document = await loadHandle.getDocument();
    if (document.numPages > MAX_PDF_PAGES) {
      throw new DocumentIngestionError("document_pdf_page_limit_exceeded");
    }

    const units: ExtractedTextUnit[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizePdfPageText(rawTextFromPdfItems(content.items));
      characterCount += text.length;
      if (characterCount > MAX_NORMALIZED_CHARS) {
        throw new DocumentIngestionError("document_text_limit_exceeded");
      }
      units.push({ pageNumber, text });
    }

    if (units.every((unit) => unit.text.length === 0)) {
      throw new DocumentIngestionError("document_no_extractable_text");
    }

    result = {
      mediaType: "pdf",
      extractorVersion: PDF_TEXT_EXTRACTOR_VERSION,
      pageCount: document.numPages,
      characterCount,
      units,
    };
  } catch (error: unknown) {
    failure = mapPdfError(error);
  } finally {
    try {
      await loadHandle?.destroy();
    } catch {
      failure ??= new DocumentIngestionError("document_pdf_extraction_failed");
    }
  }

  if (failure) throw failure;
  if (!result) throw new DocumentIngestionError("document_pdf_extraction_failed");
  return result;
}
