import type { GroundedAnswerCitation } from "../../../shared/contracts/grounded-answer";

export type KnowledgeAnswerToken =
  | { type: "text"; value: string }
  | { type: "citation"; value: string; citation: GroundedAnswerCitation };

const CANONICAL_CITATION_PATTERN = /\[S[0-9]+\]/gu;

function appendText(tokens: KnowledgeAnswerToken[], value: string): void {
  if (value.length === 0) return;
  const previous = tokens.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    return;
  }
  tokens.push({ type: "text", value });
}

export function getUniqueKnowledgeCitations(
  citations: readonly GroundedAnswerCitation[],
): GroundedAnswerCitation[] {
  const sourceIds = new Set<string>();
  return citations.filter((citation) => {
    if (sourceIds.has(citation.sourceId)) return false;
    sourceIds.add(citation.sourceId);
    return true;
  });
}

export function tokenizeKnowledgeAnswer(
  answer: string,
  citations: readonly GroundedAnswerCitation[],
): KnowledgeAnswerToken[] {
  const citationsBySourceId = new Map(
    getUniqueKnowledgeCitations(citations).map((citation) => [citation.sourceId, citation]),
  );
  const tokens: KnowledgeAnswerToken[] = [];
  let cursor = 0;

  for (const match of answer.matchAll(CANONICAL_CITATION_PATTERN)) {
    const marker = match[0];
    const index = match.index;
    appendText(tokens, answer.slice(cursor, index));
    const citation = citationsBySourceId.get(marker.slice(1, -1));
    if (citation) {
      tokens.push({ type: "citation", value: marker, citation });
    } else {
      appendText(tokens, marker);
    }
    cursor = index + marker.length;
  }

  appendText(tokens, answer.slice(cursor));
  return tokens;
}
