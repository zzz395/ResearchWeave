import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import {
  askKnowledgeRequestSchema,
  type AskKnowledgeRequest,
  type GroundedAnswerCitation,
  type GroundedAnswerResponse,
} from "../../../../shared/contracts/grounded-answer";
import { Button } from "../../../components/ui/button";
import { ErrorPanel, LoadingLabel } from "../../../components/ui/feedback";
import { TextareaField } from "../../../components/ui/form-field";
import { askKnowledge } from "../api/ask-knowledge";
import {
  getUniqueKnowledgeCitations,
  tokenizeKnowledgeAnswer,
} from "../knowledge-answer";
import { mapAskKnowledgeError } from "../knowledge-errors";

function citationLabel(citation: GroundedAnswerCitation): string {
  const page = citation.pageNumber === null ? "" : `, page ${citation.pageNumber}`;
  return `Open source ${citation.sourceId}: ${citation.originalFilename}${page}`;
}

function AnswerText({
  answer,
  citations,
  onOpenSource,
}: {
  answer: string;
  citations: readonly GroundedAnswerCitation[];
  onOpenSource: (documentId: string) => void;
}) {
  const tokens = tokenizeKnowledgeAnswer(answer, citations);
  return (
    <p className="rw-ask-answer__text">
      {tokens.map((token, index) => token.type === "text" ? token.value : (
        <button
          aria-label={citationLabel(token.citation)}
          className="rw-inline-citation"
          key={`${token.citation.sourceId}-${index}`}
          onClick={() => onOpenSource(token.citation.documentId)}
          type="button"
        >
          {token.value}
        </button>
      ))}
    </p>
  );
}

function Sources({
  citations,
  onOpenSource,
}: {
  citations: readonly GroundedAnswerCitation[];
  onOpenSource: (documentId: string) => void;
}) {
  const uniqueCitations = getUniqueKnowledgeCitations(citations);
  return (
    <section className="rw-ask-sources" aria-labelledby="ask-knowledge-sources-heading">
      <div className="rw-ask-sources__heading">
        <h4 id="ask-knowledge-sources-heading">Sources</h4>
        <span>{uniqueCitations.length} cited</span>
      </div>
      <ol>
        {uniqueCitations.map((citation) => (
          <li key={citation.sourceId}>
            <button
              aria-label={citationLabel(citation)}
              onClick={() => onOpenSource(citation.documentId)}
              type="button"
            >
              <span className="rw-ask-source__marker">[{citation.sourceId}]</span>
              <span className="rw-ask-source__filename">{citation.originalFilename}</span>
              {citation.pageNumber === null ? null : (
                <span className="rw-ask-source__page">Page {citation.pageNumber}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AskResult({
  question,
  result,
  onOpenSource,
}: {
  question: string;
  result: GroundedAnswerResponse;
  onOpenSource: (documentId: string) => void;
}) {
  return (
    <div className="rw-ask-result">
      <p className="rw-visually-hidden" role="status">
        {result.status === "answered" ? "Answer ready." : "Not enough context to answer."}
      </p>
      <div className="rw-ask-result__question">
        <span>Submitted question</span>
        <p>{question}</p>
      </div>
      {result.status === "answered" ? (
        <div className="rw-ask-answer">
          <div className="rw-ask-answer__heading">
            <h4>Answer</h4>
          </div>
          <AnswerText
            answer={result.answer}
            citations={result.citations}
            onOpenSource={onOpenSource}
          />
          <Sources citations={result.citations} onOpenSource={onOpenSource} />
        </div>
      ) : (
        <div className="rw-ask-insufficient">
          <strong>Not enough indexed evidence</strong>
          <p>{result.answer}</p>
          <small>Try asking a more specific question or add relevant documents to the knowledge base.</small>
        </div>
      )}
    </div>
  );
}

export function AskKnowledge({
  spaceId,
  onOpenSource,
}: {
  spaceId: string;
  onOpenSource: (documentId: string) => void;
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const askMutation = useMutation({
    mutationFn: (request: AskKnowledgeRequest) => askKnowledge(spaceId, request),
  });
  const requestError = askMutation.isError ? mapAskKnowledgeError(askMutation.error) : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (askMutation.isPending) return;

    const request = askKnowledgeRequestSchema.safeParse({ query: draftQuery });
    if (!request.success) {
      const trimmedLength = draftQuery.trim().length;
      setFieldError(
        trimmedLength < 2
          ? "Enter at least 2 characters after trimming spaces."
          : "Keep the question to 2,000 characters or fewer.",
      );
      return;
    }

    setFieldError(undefined);
    setSubmittedQuery(request.data.query);
    askMutation.reset();
    askMutation.mutate(request.data);
  }

  return (
    <section aria-busy={askMutation.isPending} className="rw-ask-knowledge" aria-labelledby="ask-knowledge-heading">
      <div className="rw-ask-knowledge__heading">
        <h3 id="ask-knowledge-heading">Ask Knowledge</h3>
        <p>Ask one question across this Space’s active knowledge indexes. Results are temporary and replace the previous answer.</p>
      </div>

      <form className="rw-ask-form" onSubmit={handleSubmit}>
        <TextareaField
          disabled={askMutation.isPending}
          error={fieldError}
          hint={`${draftQuery.length.toLocaleString()} / 2,000`}
          id="ask-knowledge-query"
          label="Question"
          maxLength={2000}
          onChange={(event) => {
            setDraftQuery(event.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          placeholder="What does the indexed knowledge say about…?"
          rows={3}
          value={draftQuery}
        />
        <div className="rw-ask-form__actions">
          <p>Answers use indexed Space documents only. Enter adds a new line.</p>
          <Button disabled={askMutation.isPending} type="submit">
            {askMutation.isPending ? "Generating…" : "Ask knowledge"}
          </Button>
        </div>
      </form>

      {askMutation.isPending ? (
        <div className="rw-ask-pending" aria-live="polite" role="status">
          <LoadingLabel>Generating an answer from the indexed knowledge…</LoadingLabel>
        </div>
      ) : null}
      {requestError ? (
        <ErrorPanel
          message={requestError.message}
          requestId={requestError.requestId}
          title={requestError.title}
        />
      ) : null}
      {askMutation.isSuccess && submittedQuery ? (
        <AskResult
          onOpenSource={onOpenSource}
          question={submittedQuery}
          result={askMutation.data}
        />
      ) : null}
    </section>
  );
}
