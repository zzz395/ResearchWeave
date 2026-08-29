import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { ErrorPanel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { formatResearchDate } from "../../spaces/format-research-date";
import { getDocument } from "../api/documents";
import { documentQueryKeys } from "../api/query-keys";
import {
  getActiveIndexPresentation,
  getDocumentFailureMessage,
  getDocumentMediaTypeLabel,
  getDocumentStageLabel,
  getDocumentStatusPresentation,
  shouldPollDocuments,
} from "../document-presentation";

function valueOrDash(value: string | number | null): string {
  return value === null ? "—" : String(value);
}

export function DocumentDetailDialog({
  spaceId,
  documentId,
  onOpenChange,
}: {
  spaceId: string;
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detailQuery = useQuery({
    queryKey: documentQueryKeys.detail(spaceId, documentId ?? ""),
    queryFn: () => getDocument(spaceId, documentId ?? ""),
    enabled: documentId !== null,
    refetchInterval: (query) => query.state.data && shouldPollDocuments([query.state.data])
      ? 2_000
      : false,
  });

  const document = detailQuery.data;
  const status = document ? getDocumentStatusPresentation(document) : null;
  const activeIndex = document ? getActiveIndexPresentation(document) : null;
  const failure = document ? getDocumentFailureMessage(document.errorCode) : null;
  const error = detailQuery.error instanceof ApiClientError ? detailQuery.error : null;

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={documentId !== null}>
      <Dialog.Portal>
        <Dialog.Overlay className="rw-dialog-overlay" />
        <Dialog.Content className="rw-dialog-card rw-document-detail-dialog">
          <div className="rw-dialog-card__heading">
            <div>
              <p className="rw-page-kicker">Document record</p>
              <Dialog.Title>{document?.originalFilename ?? "Document details"}</Dialog.Title>
            </div>
            <Dialog.Close className="rw-icon-button" aria-label="Close document details">
              <X aria-hidden="true" size={19} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Durable source metadata and the current indexing state. Document content and embeddings are not exposed here.
          </Dialog.Description>
          {detailQuery.isPending ? <PageLoading label="Loading document details" /> : null}
          {error ? (
            <ErrorPanel
              message={error.message}
              onRetry={() => void detailQuery.refetch()}
              requestId={error.requestId}
              title="Document details could not be loaded"
            />
          ) : null}
          {document && status && activeIndex ? (
            <>
              <div className="rw-document-detail-state">
                <div><span>Current status</span><strong>{status.primary}</strong><small>{status.secondary}</small></div>
                <div><span>Active index</span><strong>{activeIndex.label}</strong><small>{activeIndex.detail}</small></div>
              </div>
              {failure ? <div className="rw-document-failure" role="status"><strong>Latest failure</strong><span>{failure}</span></div> : null}
              <dl className="rw-document-detail-grid">
                <div><dt>Filename</dt><dd>{document.originalFilename}</dd></div>
                <div><dt>Media type</dt><dd>{getDocumentMediaTypeLabel(document.mediaType)}</dd></div>
                <div><dt>Upload time</dt><dd>{formatResearchDate(document.createdAt)}</dd></div>
                <div><dt>Current stage</dt><dd>{getDocumentStageLabel(document.stage)}</dd></div>
                <div><dt>Attempts</dt><dd>{document.attemptCount}</dd></div>
                <div><dt>Last attempt</dt><dd>{document.lastAttemptAt ? formatResearchDate(document.lastAttemptAt) : "—"}</dd></div>
                <div><dt>Page count</dt><dd>{valueOrDash(document.pageCount)}</dd></div>
                <div><dt>Character count</dt><dd>{document.characterCount?.toLocaleString() ?? "—"}</dd></div>
                <div><dt>Chunk count</dt><dd>{document.chunkCount.toLocaleString()}</dd></div>
                <div><dt>Extractor version</dt><dd className="rw-mono">{valueOrDash(document.extractorVersion)}</dd></div>
                <div><dt>Chunker version</dt><dd className="rw-mono">{valueOrDash(document.chunkerVersion)}</dd></div>
                <div><dt>Embedding model</dt><dd className="rw-mono">{valueOrDash(document.embeddingModel)}</dd></div>
                <div><dt>Embedding dimensions</dt><dd>{valueOrDash(document.embeddingDimensions)}</dd></div>
                <div><dt>Last indexed time</dt><dd>{document.indexedAt ? formatResearchDate(document.indexedAt) : "—"}</dd></div>
                <div><dt>Index fingerprint</dt><dd className="rw-mono">{document.indexFingerprint ? `${document.indexFingerprint.slice(0, 12)}…` : "—"}</dd></div>
              </dl>
              <div className="rw-form-actions rw-form-actions--end">
                <Dialog.Close asChild><Button variant="secondary">Close</Button></Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
