import * as Dialog from "@radix-ui/react-dialog";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Database, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Document } from "../../../../shared/contracts/documents";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useAuth } from "../../auth/auth-state";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { deleteDocument, listDocuments, reindexDocument } from "../api/documents";
import { documentQueryKeys } from "../api/query-keys";
import { DocumentDetailDialog } from "../components/document-detail-dialog";
import { DocumentList } from "../components/document-list";
import { DocumentUploadDialog } from "../components/document-upload-dialog";
import { getDocumentSummary, shouldPollDocuments } from "../document-presentation";

const DOCUMENT_PAGE_SIZE = 50;

export function Component() {
  const space = useSpaceLayout();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const queryKey = documentQueryKeys.list(space.id);
  const documentsQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => listDocuments(space.id, {
      cursor: pageParam,
      limit: DOCUMENT_PAGE_SIZE,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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
          <p className="rw-page-kicker">Space knowledge</p>
          <h2>Knowledge Base</h2>
          <p>Durable research sources and their current indexing state.</p>
        </div>
        <div>
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

      <div className="rw-knowledge-summary" aria-label="Loaded document summary">
        <div><span>Total</span><strong>{summary.total}</strong><small>{documentsQuery.hasNextPage ? "loaded records" : "documents"}</small></div>
        <div><span>Indexed</span><strong>{summary.indexed}</strong><small>active indexes</small></div>
        <div><span>Processing</span><strong>{summary.processing}</strong><small>queued or active</small></div>
        <div><span>Failed</span><strong>{summary.failed}</strong><small>latest attempts</small></div>
      </div>

      <div className="rw-knowledge-list-heading">
        <div><p className="rw-page-kicker">Source ledger</p><h3>Documents</h3></div>
        <span>{documentsQuery.hasNextPage ? `${documents.length} loaded` : `${documents.length} total`}</span>
      </div>

      {documents.length === 0 ? (
        <div className="rw-knowledge-empty">
          <Database aria-hidden="true" size={28} />
          <div><h3>No documents yet</h3><p>Upload a research source to begin building durable knowledge for this Space.</p></div>
          <DocumentUploadDialog onUploaded={setNotice} spaceId={space.id} />
        </div>
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
