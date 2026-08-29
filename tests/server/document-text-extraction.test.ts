import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DocumentIngestionError } from "../../server/modules/documents/document-ingestion-errors";
import {
  MAX_NORMALIZED_CHARS,
  MAX_PDF_PAGES,
  PDF_MAX_IMAGE_SIZE,
} from "../../server/modules/documents/document-text-extractor";
import { createDocumentTextExtractor } from "../../server/integrations/document-extraction/document-text-extractor";
import {
  extractPdfText,
  normalizePdfPageText,
  rawTextFromPdfItems,
  type PdfDocumentHandle,
  type PdfDocumentLoadHandle,
  type PdfDocumentLoader,
} from "../../server/integrations/document-extraction/pdf-document-text-extractor";

const fixture = (name: string) =>
  readFile(new URL(`../fixtures/documents/${name}`, import.meta.url));
const encode = (value: string) => new TextEncoder().encode(value);

function errorCode(error: unknown): string | undefined {
  return error instanceof DocumentIngestionError ? error.code : undefined;
}

function fakePdfLoader(options: {
  pages?: unknown[][];
  numPages?: number;
  startError?: Error;
  documentError?: Error;
  pageError?: { pageNumber: number; error: Error };
  destroyError?: Error;
  events?: string[];
}): {
  loader: PdfDocumentLoader;
  loadHandle: PdfDocumentLoadHandle;
  document: PdfDocumentHandle;
  calls: number[];
} {
  const calls: number[] = [];
  const pages = options.pages ?? [];
  const document: PdfDocumentHandle = {
    numPages: options.numPages ?? pages.length,
    getPage(pageNumber) {
      calls.push(pageNumber);
      options.events?.push(`get:${pageNumber}`);
      if (options.pageError?.pageNumber === pageNumber) {
        return Promise.reject(options.pageError.error);
      }
      return Promise.resolve({
        getTextContent() {
          options.events?.push(`text:${pageNumber}`);
          return Promise.resolve({ items: pages[pageNumber - 1] ?? [] });
        },
      });
    },
  };
  const loadHandle: PdfDocumentLoadHandle = {
    getDocument() {
      if (options.documentError) {
        options.events?.push("document-reject");
        return Promise.reject(options.documentError);
      }
      options.events?.push("document");
      return Promise.resolve(document);
    },
    destroy() {
      options.events?.push("destroy");
      return options.destroyError ? Promise.reject(options.destroyError) : Promise.resolve();
    },
  };
  return {
    document,
    loadHandle,
    calls,
    loader: {
      start(_bytes, loadOptions) {
        options.events?.push("start");
        expect(loadOptions).toEqual({ maxImageSize: PDF_MAX_IMAGE_SIZE });
        return options.startError
          ? Promise.reject(options.startError)
          : Promise.resolve(loadHandle);
      },
    },
  };
}

describe("TXT and Markdown extraction", () => {
  const extractor = createDocumentTextExtractor();

  it("strictly decodes UTF-8 and applies the frozen source normalization order", async () => {
    const bytes = encode("\uFEFF  Cafe\u0301\r\nline two\rlast  \n");
    const result = await extractor.extract({ mediaType: "text", bytes });
    expect(result).toEqual({
      mediaType: "text",
      extractorVersion: "utf8-source-v1",
      pageCount: null,
      characterCount: "Café\nline two\nlast".length,
      units: [{ pageNumber: null, text: "Café\nline two\nlast" }],
    });
    expect(await extractor.extract({ mediaType: "text", bytes })).toEqual(result);
  });

  it("removes one leading BOM without deleting other U+FEFF characters", async () => {
    const result = await extractor.extract({
      mediaType: "text",
      bytes: encode("\uFEFF\uFEFFbody\uFEFFinside\uFEFF"),
    });
    expect(result.units[0]?.text).toBe("\uFEFFbody\uFEFFinside\uFEFF");
  });

  it("rejects invalid UTF-8 with a stable error", async () => {
    await expect(
      extractor.extract({ mediaType: "text", bytes: Uint8Array.from([0xc3, 0x28]) }),
    ).rejects.toMatchObject({ code: "document_invalid_utf8" });
  });

  it("preserves Markdown source syntax while normalizing newlines and NFC", async () => {
    const source =
      "\uFEFF# Cafe\u0301\r\n\r\n- item\r\n\r\n`code` and [link](https://example.test)\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n";
    const result = await extractor.extract({ mediaType: "markdown", bytes: encode(source) });
    expect(result.units[0]?.text).toBe(
      "# Café\n\n- item\n\n`code` and [link](https://example.test)\n\n```ts\nconst x = 1;\n```",
    );
    expect(result.units[0]?.pageNumber).toBeNull();
    expect(await extractor.extract({ mediaType: "markdown", bytes: encode(source) })).toEqual(
      result,
    );
  });

  it("allows exactly 2,000,000 normalized characters and rejects 2,000,001", async () => {
    const allowed = await extractor.extract({
      mediaType: "text",
      bytes: encode("a".repeat(MAX_NORMALIZED_CHARS)),
    });
    expect(allowed.characterCount).toBe(MAX_NORMALIZED_CHARS);
    await expect(
      extractor.extract({
        mediaType: "text",
        bytes: encode("a".repeat(MAX_NORMALIZED_CHARS + 1)),
      }),
    ).rejects.toMatchObject({ code: "document_text_limit_exceeded" });
  });
});

describe("PDF extraction", () => {
  it("extracts a real multipage fixture with physical page provenance", async () => {
    const bytes = await fixture("two-page-text.pdf");
    const first = await extractPdfText(bytes);
    expect(first).toMatchObject({
      mediaType: "pdf",
      extractorVersion: "pdf-unpdf-v1",
      pageCount: 2,
      units: [{ pageNumber: 1 }, { pageNumber: 2 }],
    });
    expect(first.units[0]?.text).toContain("Page one heading");
    expect(first.units[0]?.text).toContain("This paper proposes a new method for retrieval.");
    expect(first.units[1]?.text).toBe("Page two is isolated.");
    expect(first.characterCount).toBe(first.units.reduce((sum, unit) => sum + unit.text.length, 0));
    expect(await extractPdfText(bytes)).toEqual(first);
  });

  it("keeps empty physical pages but rejects an entirely no-text real PDF", async () => {
    const partial = fakePdfLoader({
      pages: [[{ str: "page one" }], [], [{ str: "page three" }]],
    });
    const result = await extractPdfText(new Uint8Array(), partial.loader);
    expect(result.pageCount).toBe(3);
    expect(result.units).toEqual([
      { pageNumber: 1, text: "page one" },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "page three" },
    ]);
    await expect(extractPdfText(await fixture("no-text.pdf"))).rejects.toMatchObject({
      code: "document_no_extractable_text",
    });
  });

  it("maps a real header-only malformed PDF as invalid", async () => {
    await expect(extractPdfText(await fixture("malformed.pdf"))).rejects.toMatchObject({
      code: "document_pdf_invalid",
    });
  });

  it("constructs item-order text and applies deterministic page normalization", () => {
    const raw = rawTextFromPdfItems([
      { str: "  This\u00A0paper\tproposes", hasEOL: true },
      { type: "beginMarkedContent" },
      { str: "a new\u00AD", hasEOL: true },
      { str: "method.  ", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "Paragraph B\r\nline two" },
    ]);
    expect(normalizePdfPageText(raw)).toBe(
      "This paper proposes a new method.\n\nParagraph B line two",
    );
    expect(normalizePdfPageText("Cafe\u0301\ninter-\nnational")).toBe(
      "Café inter- national",
    );
  });

  it("fails the page limit before requesting pages and still destroys the document", async () => {
    const atLimit = fakePdfLoader({
      pages: Array.from({ length: MAX_PDF_PAGES }, () => [{ str: "x" }]),
    });
    const allowed = await extractPdfText(new Uint8Array(), atLimit.loader);
    expect(allowed.pageCount).toBe(MAX_PDF_PAGES);
    expect(atLimit.calls).toHaveLength(MAX_PDF_PAGES);

    const events: string[] = [];
    const fake = fakePdfLoader({ numPages: MAX_PDF_PAGES + 1, events });
    await expect(extractPdfText(new Uint8Array(), fake.loader)).rejects.toMatchObject({
      code: "document_pdf_page_limit_exceeded",
    });
    expect(fake.calls).toEqual([]);
    expect(events).toEqual(["start", "document", "destroy"]);
  });

  it("checks the normalized character limit after each sequential page", async () => {
    const atLimit = fakePdfLoader({
      pages: [[{ str: "a".repeat(MAX_NORMALIZED_CHARS) }]],
    });
    expect((await extractPdfText(new Uint8Array(), atLimit.loader)).characterCount).toBe(
      MAX_NORMALIZED_CHARS,
    );

    const events: string[] = [];
    const fake = fakePdfLoader({
      pages: [
        [{ str: "a".repeat(MAX_NORMALIZED_CHARS) }],
        [{ str: "b" }],
        [{ str: "not reached" }],
      ],
      events,
    });
    await expect(extractPdfText(new Uint8Array(), fake.loader)).rejects.toMatchObject({
      code: "document_text_limit_exceeded",
    });
    expect(fake.calls).toEqual([1, 2]);
    expect(events).toEqual([
      "start",
      "document",
      "get:1",
      "text:1",
      "get:2",
      "text:2",
      "destroy",
    ]);
  });

  it("processes pages sequentially and cleans up on success and page failure", async () => {
    const successEvents: string[] = [];
    const success = fakePdfLoader({
      pages: [[{ str: "one" }], [{ str: "two" }]],
      events: successEvents,
    });
    await extractPdfText(new Uint8Array(), success.loader);
    expect(successEvents).toEqual([
      "start",
      "document",
      "get:1",
      "text:1",
      "get:2",
      "text:2",
      "destroy",
    ]);

    const failureEvents: string[] = [];
    const failure = fakePdfLoader({
      pages: [[{ str: "one" }], [{ str: "two" }]],
      pageError: { pageNumber: 2, error: new Error("parser detail") },
      events: failureEvents,
    });
    await expect(extractPdfText(new Uint8Array(), failure.loader)).rejects.toMatchObject({
      code: "document_pdf_extraction_failed",
    });
    expect(failureEvents).toEqual([
      "start",
      "document",
      "get:1",
      "text:1",
      "get:2",
      "destroy",
    ]);
  });

  it("does not invent cleanup ownership when start fails before creating a loading task", async () => {
    const events: string[] = [];
    const fake = fakePdfLoader({ startError: new Error("start detail"), events });
    await expect(extractPdfText(new Uint8Array(), fake.loader)).rejects.toMatchObject({
      code: "document_pdf_extraction_failed",
    });
    expect(events).toEqual(["start"]);
  });

  it.each([
    ["PasswordException", "document_pdf_password_protected"],
    ["InvalidPDFException", "document_pdf_invalid"],
    ["MissingPDFException", "document_pdf_invalid"],
    ["FormatError", "document_pdf_invalid"],
    ["UnexpectedResponseException", "document_pdf_extraction_failed"],
  ])("narrowly maps %s without exposing parser details", async (name, expectedCode) => {
    const parserError = Object.assign(new Error("sensitive parser detail"), { name });
    const events: string[] = [];
    const fake = fakePdfLoader({ documentError: parserError, events });
    try {
      await extractPdfText(new Uint8Array(), fake.loader);
      expect.unreachable();
    } catch (error: unknown) {
      expect(errorCode(error)).toBe(expectedCode);
      expect(error).not.toHaveProperty("cause");
      expect((error as Error).message).not.toContain("sensitive");
    }
    expect(events).toEqual(["start", "document-reject", "destroy"]);
  });

  it("maps cleanup failure stably and preserves an earlier primary failure", async () => {
    const cleanupOnlyEvents: string[] = [];
    const cleanupOnly = fakePdfLoader({
      pages: [[{ str: "text" }]],
      destroyError: new Error("cleanup detail"),
      events: cleanupOnlyEvents,
    });
    await expect(extractPdfText(new Uint8Array(), cleanupOnly.loader)).rejects.toMatchObject({
      code: "document_pdf_extraction_failed",
    });
    expect(cleanupOnlyEvents).toEqual([
      "start",
      "document",
      "get:1",
      "text:1",
      "destroy",
    ]);

    const primaryEvents: string[] = [];
    const primary = fakePdfLoader({
      pages: [[{ str: "text" }]],
      numPages: MAX_PDF_PAGES + 1,
      destroyError: new Error("cleanup detail"),
      events: primaryEvents,
    });
    await expect(extractPdfText(new Uint8Array(), primary.loader)).rejects.toMatchObject({
      code: "document_pdf_page_limit_exceeded",
    });
    expect(primaryEvents).toEqual(["start", "document", "destroy"]);
  });
});
