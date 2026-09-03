import * as Dialog from "@radix-ui/react-dialog";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Database, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Document } from "../../../../shared/contracts/documents";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, EmptyState, ErrorPanel, LoadingLabel, PageLoading, SectionHeader } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useAuth } from "../../auth/auth-state";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { documentListQueryOptions } from "../api/document-list-query";
import { deleteDocument, reindexDocument } from "../api/documents";
import { documentQueryKeys } from "../api/query-keys";
import { AskKnowledge } from "../components/ask-knowledge";
import { DocumentDetailDialog } from "../components/document-detail-dialog";
import { DocumentList } from "../components/document-list";
import { DocumentUploadDialog } from "../components/document-upload-dialog";
import {
  getDocumentSummary,
  isTrueZeroDocumentList,
  shouldPollDocuments,
} from "../document-presentation";
import { getAskKnowledgeInstanceKey } from "../knowledge-page-state";

export function Component() {
  const space = useSpaceLayout();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const queryKey = documentQueryKeys.list(space.id);
  const documentsQuery = useInfiniteQuery({
    ...documentListQueryOptions(space.id),
    refetchInterval: (query) => {
      const documents = query.state.data?.pages.flatMap((page) => page.documents) ?? [];
      return shouldPollDocuments(documents) ? 2_000 : false;
    },
  });
  const reindexMutation = useMutation({
    mutationFn: (documentId: string) => reindexDocument(space.id, documentId),
  });
  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => deleteDocument(space.id, documentId),
  });

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.documents) ?? [],
    [documentsQuery.data],
  );
  const firstDocumentPage = documentsQuery.data?.pages[0];
  const isTrueZero = isTrueZeroDocumentList(documents, firstDocumentPage?.nextCursor);
  const summary = getDocumentSummary(documents);

  async function handleReindex(document: Document) {
    setNotice(null);
    try {
      const queued = await reindexMutation.mutateAsync(document.id);
      queryClient.setQueryData(documentQueryKeys.detail(space.id, document.id), queued);
      await queryClient.invalidateQueries({ queryKey, exact: true });
      setNotice(
        document.status === "failed"
          ? "Document queued to retry indexing."
          : "Document queued for reindexing. The current index remains available during rebuild.",
      );
    } catch {
      // The durable list remains unchanged and the server error is rendered below.
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setNotice(null);
    try {
      const deletedId = deleteTarget.id;
      await deleteMutation.mutateAsync(deletedId);
      queryClient.removeQueries({ queryKey: documentQueryKeys.detail(space.id, deletedId), exact: true });
      await queryClient.invalidateQueries({ queryKey, exact: true });
      if (selectedDocumentId === deletedId) setSelectedDocumentId(null);
      setDeleteTarget(null);
      setNotice("Document and indexed knowledge removed from this Space.");
    } catch {
      // Keep the confirmation open so the real server error can be acted on.
    }
  }

  const reindexError = reindexMutation.error instanceof ApiClientError
    ? reindexMutation.error
    : null;
  const deleteError = deleteMutation.error instanceof ApiClientError ? deleteMutation.error : null;

  if (documentsQuery.isPending) return <PageLoading label="Loading Knowledge Base" />;
  if (documentsQuery.error) {
    const error = documentsQuery.error instanceof ApiClientError ? documentsQuery.error : null;
    return (
      <section className="rw-space-tab-panel">
        <ErrorPanel
          message={error?.message ?? "Documents could not be loaded."}
          onRetry={() => void documentsQuery.refetch()}
          requestId={error?.requestId}
          title="Knowledge Base could not be loaded"
        />
      </section>
    );
  }

  return (
    <section className="rw-space-tab-panel rw-knowledge-page">
      <header className="rw-knowledge-header">
        <div>
          <h2>Knowledge Base</h2>
          <p>Ask grounded questions, then manage the durable sources and indexes that support each answer.</p>
        </div>
        <div className="rw-action-group">
          <Button
            disabled={documentsQuery.isFetching}
            onClick={() => void documentsQuery.refetch()}
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {documentsQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
          <DocumentUploadDialog onUploaded={setNotice} spaceId={space.id} />
        </div>
      </header>

      {notice ? <div className="rw-knowledge-notice" role="status">{notice}</div> : null}
      {reindexError ? (
        <Alert><strong>Indexing could not be queued.</strong><span>{reindexError.message}</span></Alert>
      ) : null}

      {isTrueZero ? (
        <section aria-busy={documentsQuery.isFetching} className="rw-knowledge-onboarding" aria-labelledby="knowledge-onboarding-heading">
          <div className="rw-knowledge-onboarding__intro">
            <Database aria-hidden="true" size={28} />
            <div>
              <p className="rw-context-label">Start with a source</p>
              <h3 id="knowledge-onboarding-heading">Build grounded knowledge in three steps.</h3>
              <p>Add and index a source before asking grounded questions.</p>
            </div>
          </div>
          <ol>
            <li><span>01</span><div><strong>Upload source</strong><p>Add a PDF, text, or Markdown research document.</p></div></li>
            <li><span>02</span><div><strong>Wait for indexing</strong><p>ResearchWeave extracts, chunks, and prepares the active index.</p></div></li>
            <li><span>03</span><div><strong>Ask grounded questions</strong><p>Answers use indexed Space documents and server-authoritative citations.</p></div></li>
          </ol>
          <DocumentUploadDialog onUploaded={setNotice} spaceId={space.id} />
        </section>
      ) : (
        <>
          <AskKnowledge
            key={getAskKnowledgeInstanceKey(space.id)}
            onOpenSource={setSelectedDocumentId}
            spaceId={space.id}
          />

          <section aria-busy={documentsQuery.isFetching} aria-labelledby="knowledge-documents-heading">
            <dl className="rw-knowledge-summary" aria-label="Loaded document status">
              <div><dt>{documentsQuery.hasNextPage ? "Loaded" : "Documents"}</dt><dd>{summary.total}</dd></div>
              <div><dt>Indexed</dt><dd>{summary.indexed}</dd></div>
              <div><dt>Processing</dt><dd>{summary.processing}</dd></div>
              <div><dt>Failed</dt><dd>{summary.failed}</dd></div>
            </dl>

            <SectionHeader
              className="rw-knowledge-list-heading"
              count={documentsQuery.hasNextPage ? `${documents.length} loaded` : `${documents.length} total`}
              headingId="knowledge-documents-heading"
              headingLevel={3}
              title="Documents"
            />

            {documents.length === 0 ? (
              <EmptyState className="rw-knowledge-empty">
                <Database aria-hidden="true" size={28} />
                <div><h3>No documents in this loaded page</h3><p>More source records may be available. This state does not determine whole-Space knowledge readiness.</p></div>
              </EmptyState>
            ) : (
              <DocumentList
                currentUserId={user?.id}
                documents={documents}
                onDelete={(document) => { deleteMutation.reset(); setDeleteTarget(document); }}
                onReindex={(document) => void handleReindex(document)}
                onView={(document) => setSelectedDocumentId(document.id)}
                reindexingId={reindexMutation.isPending ? (reindexMutation.variables ?? null) : null}
                spaceRole={space.role}
              />
            )}

            {documentsQuery.hasNextPage ? (
              <div className="rw-knowledge-load-more">
                <Button
                  disabled={documentsQuery.isFetchingNextPage}
                  onClick={() => void documentsQuery.fetchNextPage()}
                  variant="secondary"
                >
                  {documentsQuery.isFetchingNextPage ? <LoadingLabel>Loading documents</LoadingLabel> : "Load more documents"}
                </Button>
                <span>Summary counts reflect the currently loaded records.</span>
              </div>
            ) : null}
          </section>
        </>
      )}

      <DocumentDetailDialog
        documentId={selectedDocumentId}
        onOpenChange={(open) => { if (!open) setSelectedDocumentId(null); }}
        spaceId={space.id}
      />

      <Dialog.Root
        onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}
        open={deleteTarget !== null}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="rw-dialog-overlay" />
          <Dialog.Content className="rw-dialog-card">
            <div className="rw-dialog-card__heading">
              <div><p className="rw-page-kicker">Permanent action</p><Dialog.Title>Delete “{deleteTarget?.originalFilename}”?</Dialog.Title></div>
              <Dialog.Close className="rw-icon-button" aria-label="Close delete confirmation"><X aria-hidden="true" size={19} /></Dialog.Close>
            </div>
            <Dialog.Description>
              This removes the document and its indexed knowledge from this space.
            </Dialog.Description>
            {deleteError ? <Alert><strong>Document could not be deleted.</strong><span>{deleteError.message}</span></Alert> : null}
            <div className="rw-form-actions rw-form-actions--end">
              <Dialog.Close asChild><Button disabled={deleteMutation.isPending} variant="secondary">Keep document</Button></Dialog.Close>
              <Button disabled={deleteMutation.isPending} onClick={() => void handleDelete()} variant="danger">
                {deleteMutation.isPending ? <LoadingLabel>Deleting document</LoadingLabel> : <><Trash2 aria-hidden="true" size={16} />Delete permanently</>}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
