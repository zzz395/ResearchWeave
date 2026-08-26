import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  researchPaperSchema,
  researchPaperSearchResultSchema,
  type ResearchPaper,
  type ResearchPaperSearchResult,
} from "../../../shared/contracts/research";
import { ArxivIntegrationError, isArxivIntegrationError } from "./errors";
import { parseArxivIdentifier, resolveArxivIdentifier } from "./identifier";

const ARXIV_CATEGORY_SCHEME = "http://arxiv.org/schemas/atom";
const ARXIV_CATEGORY_TERM = /^[a-z][a-z-]*(?:\.[A-Za-z-]+)?$/u;

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  processEntities: false,
});

function asRecord(value: unknown): XmlRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map((item: unknown) => item) : [value];
}

function decodeXmlEntities(value: string) {
  const predefined: Record<string, string> = {
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&quot;": '"',
  };
  return value.replace(
    /&(?:amp|apos|gt|lt|quot);|&#(?:\d+|x[\dA-Fa-f]+);/gu,
    (entity) => {
      const known = predefined[entity];
      if (known !== undefined) return known;
      const hexadecimal = entity.startsWith("&#x");
      const digits = entity.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function text(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return decodeXmlEntities(String(value));
  }
  return asRecord(value)?.["#text"] === undefined
    ? undefined
    : decodeXmlEntities(String(asRecord(value)?.["#text"]));
}

function normalizedText(value: unknown) {
  const normalized = text(value)?.replace(/\s+/gu, " ").trim();
  return normalized || undefined;
}

function requiredText(value: unknown, field: string) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      `arXiv returned paper metadata without ${field}.`,
    );
  }
  return normalized;
}

function parseNonnegativeInteger(value: unknown, field: string) {
  const raw = normalizedText(value);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      `arXiv returned an invalid ${field}.`,
    );
  }
  return parsed;
}

function parseTimestamp(value: unknown, field: string) {
  const raw = requiredText(value, field);
  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      `arXiv returned an invalid ${field}.`,
    );
  }
  return timestamp.toISOString();
}

function attribute(record: XmlRecord | undefined, name: string) {
  const value = record?.[`@_${name}`];
  return typeof value === "string" ? decodeXmlEntities(value).trim() : undefined;
}

function isErrorEntry(entry: XmlRecord) {
  const values = [
    normalizedText(entry.id),
    ...asArray(entry.link).map((link) => attribute(asRecord(link), "href")),
  ];
  return values.some((value) => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return /^(?:www\.)?arxiv\.org$/iu.test(url.hostname) && url.pathname === "/api/errors";
    } catch {
      return false;
    }
  });
}

function parsePaper(entry: XmlRecord): ResearchPaper {
  const links = asArray(entry.link).map(asRecord).filter((link) => link !== undefined);
  const abstractLink = links.find((link) => attribute(link, "rel") === "alternate");
  const pdfLink = links.find(
    (link) =>
      attribute(link, "title")?.toLowerCase() === "pdf" ||
      attribute(link, "type")?.toLowerCase() === "application/pdf",
  );
  const entryId = requiredText(entry.id, "an identifier");
  const absHref = attribute(abstractLink, "href");
  const pdfHref = attribute(pdfLink, "href");
  if (!absHref || !pdfHref) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned paper metadata without trusted source links.",
    );
  }

  const identifier = resolveArxivIdentifier([entryId, absHref, pdfHref]);
  const linkIdentifiers = [absHref, pdfHref].map(parseArxivIdentifier);
  if (
    linkIdentifiers.some(
      (value) => !value || value.canonicalArxivId !== identifier.canonicalArxivId,
    )
  ) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned conflicting paper source links.",
    );
  }

  const authors = asArray(entry.author).map((author) =>
    requiredText(asRecord(author)?.name, "an author name"),
  );
  if (authors.length === 0) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned paper metadata without authors.",
    );
  }

  const primaryCategoryRecord = asRecord(entry["arxiv:primary_category"]);
  const primaryCategory = attribute(primaryCategoryRecord, "term");
  if (!primaryCategory || !ARXIV_CATEGORY_TERM.test(primaryCategory)) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned paper metadata without a valid primary category.",
    );
  }

  const categories = [
    ...new Set(
      asArray(entry.category)
        .map(asRecord)
        .filter(
          (category) =>
            attribute(category, "scheme") === ARXIV_CATEGORY_SCHEME &&
            ARXIV_CATEGORY_TERM.test(attribute(category, "term") ?? ""),
        )
        .map((category) => attribute(category, "term") as string),
    ),
  ];
  if (!categories.includes(primaryCategory)) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned inconsistent category metadata.",
    );
  }

  const comment = normalizedText(entry["arxiv:comment"]);
  const journalRef = normalizedText(entry["arxiv:journal_ref"]);
  const doi = normalizedText(entry["arxiv:doi"]);

  return researchPaperSchema.parse({
    ...identifier,
    title: requiredText(entry.title, "a title"),
    abstract: requiredText(entry.summary, "an abstract"),
    authors,
    primaryCategory,
    categories,
    publishedAt: parseTimestamp(entry.published, "published timestamp"),
    updatedAt: parseTimestamp(entry.updated, "updated timestamp"),
    ...(comment ? { comment } : {}),
    ...(journalRef ? { journalRef } : {}),
    ...(doi ? { doi } : {}),
    absUrl: `https://arxiv.org/abs/${identifier.versionedArxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${identifier.versionedArxivId}`,
  });
}

export function parseArxivAtom(xml: string): ResearchPaperSearchResult {
  try {
    if (XMLValidator.validate(xml) !== true) {
      throw new ArxivIntegrationError(
        "ARXIV_INVALID_RESPONSE",
        "arXiv returned malformed XML.",
      );
    }

    const document = asRecord(parser.parse(xml));
    const feed = asRecord(document?.feed);
    if (!feed) {
      throw new ArxivIntegrationError(
        "ARXIV_INVALID_RESPONSE",
        "arXiv returned an invalid Atom feed.",
      );
    }

    const entries = asArray(feed.entry).map(asRecord).filter((entry) => entry !== undefined);
    if (entries.some(isErrorEntry)) {
      throw new ArxivIntegrationError(
        "ARXIV_UPSTREAM_ERROR",
        "arXiv returned an API error feed.",
      );
    }

    return researchPaperSearchResultSchema.parse({
      totalResults: parseNonnegativeInteger(feed["opensearch:totalResults"], "total result count"),
      startIndex: parseNonnegativeInteger(feed["opensearch:startIndex"], "start index"),
      itemsPerPage: parseNonnegativeInteger(feed["opensearch:itemsPerPage"], "page size"),
      papers: entries.map(parsePaper),
    });
  } catch (error: unknown) {
    if (isArxivIntegrationError(error)) throw error;
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned an invalid Atom response.",
      { cause: error },
    );
  }
}
