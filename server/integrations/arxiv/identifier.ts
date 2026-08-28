import { ArxivIntegrationError } from "./errors";

const MODERN_ID = /^(?<yearMonth>\d{4})\.(?<sequence>\d+)(?:v(?<version>[1-9]\d*))?$/u;
const LEGACY_ID = /^(?<canonical>[a-z][A-Za-z0-9.-]*\/\d{7})(?:v(?<version>[1-9]\d*))?$/u;

export interface ParsedArxivIdentifier {
  canonicalArxivId: string;
  version?: number;
}

function identifierFromValue(value: string) {
  const trimmed = value.trim().replace(/^arXiv:/iu, "");

  try {
    const url = new URL(trimmed);
    if (!/^https?:$/u.test(url.protocol) || !/^(?:www\.)?arxiv\.org$/iu.test(url.hostname)) {
      return undefined;
    }
    const match = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/u.exec(url.pathname);
    return match?.[1];
  } catch {
    return trimmed;
  }
}

export function parseArxivIdentifier(value: string): ParsedArxivIdentifier | undefined {
  const candidate = identifierFromValue(value);
  if (!candidate) return undefined;

  const modernMatch = MODERN_ID.exec(candidate);
  if (modernMatch?.groups) {
    const { yearMonth, sequence, version: rawVersion } = modernMatch.groups;
    const month = Number(yearMonth.slice(2));
    const era = Number(yearMonth);
    const expectedSequenceLength = era >= 1501 ? 5 : era >= 704 ? 4 : undefined;
    if (
      month < 1 ||
      month > 12 ||
      sequence.length !== expectedSequenceLength ||
      Number(sequence) < 1
    ) {
      return undefined;
    }
    return {
      canonicalArxivId: `${yearMonth}.${sequence}`,
      version: rawVersion ? Number(rawVersion) : undefined,
    };
  }

  const legacyMatch = LEGACY_ID.exec(candidate);
  if (!legacyMatch?.groups) return undefined;
  const version = legacyMatch.groups.version ? Number(legacyMatch.groups.version) : undefined;
  return { canonicalArxivId: legacyMatch.groups.canonical, version };
}

export function resolveArxivIdentifier(values: string[]) {
  const parsed = values.map(parseArxivIdentifier).filter((value) => value !== undefined);
  if (parsed.length !== values.length) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned paper metadata without a valid identifier.",
    );
  }

  const canonicalIds = new Set(parsed.map((value) => value.canonicalArxivId));
  const versions = new Set(
    parsed.flatMap((value) => (value.version === undefined ? [] : [value.version])),
  );
  if (canonicalIds.size !== 1 || versions.size !== 1) {
    throw new ArxivIntegrationError(
      "ARXIV_INVALID_RESPONSE",
      "arXiv returned conflicting paper identifiers.",
    );
  }

  const canonicalArxivId = parsed[0].canonicalArxivId;
  const version = [...versions][0];
  return {
    canonicalArxivId,
    versionedArxivId: `${canonicalArxivId}v${version}`,
    version,
  };
}
