import { Eye, RefreshCw, Trash2 } from "lucide-react";

import type { Document } from "../../../../shared/contracts/documents";
import { Button } from "../../../components/ui/button";
import { formatResearchDate } from "../../spaces/format-research-date";
import {
  canManageDocument,
  getActiveIndexPresentation,
  getDocumentMediaTypeLabel,
  getReindexActionLabel,
} from "../document-presentation";
import { DocumentStatus } from "./document-status";

export function DocumentList({
  documents,
  currentUserId,
  spaceRole,
  reindexingId,
  onView,
  onReindex,
  onDelete,
}: {
  documents: readonly Document[];
  currentUserId: string | undefined;
  spaceRole: "owner" | "member";
  reindexingId: string | null;
  onView: (document: Document) => void;
  onReindex: (document: Document) => void;
  onDelete: (document: Document) => void;
}) {
  return (
    <div className="rw-document-table-wrap">
      <table className="rw-document-table">
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Indexing</th>
            <th scope="col">Active index</th>
            <th scope="col">Knowledge</th>
            <th scope="col">Timeline</th>
            <th scope="col"><span className="rw-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const activeIndex = getActiveIndexPresentation(document);
            const reindexLabel = getReindexActionLabel(document.status);
            const canManage = canManageDocument(document, spaceRole, currentUserId);
            return (
              <tr key={document.id}>
                <td>
                  <button className="rw-document-name" onClick={() => onView(document)} type="button">
                    {document.originalFilename}
                  </button>
                  <span>{getDocumentMediaTypeLabel(document.mediaType)} · {(document.sizeBytes / 1024).toFixed(1)} KB</span>
                </td>
                <td><DocumentStatus document={document} /></td>
                <td>
                  <span className={`rw-index-state ${activeIndex.available ? "is-available" : ""}`}>
                    {activeIndex.label}
                  </span>
                  <small>{activeIndex.detail}</small>
                </td>
                <td>
                  <strong>{document.chunkCount.toLocaleString()}</strong>
                  <span>chunks</span>
                </td>
                <td>
                  <time dateTime={document.createdAt}>Uploaded {formatResearchDate(document.createdAt)}</time>
                  <span>{document.indexedAt ? `Indexed ${formatResearchDate(document.indexedAt)}` : "Not indexed yet"}</span>
                </td>
                <td>
                  <div className="rw-document-actions">
                    <Button aria-label={`View ${document.originalFilename}`} onClick={() => onView(document)} variant="ghost">
                      <Eye aria-hidden="true" size={15} />View
                    </Button>
                    {canManage && reindexLabel ? (
                      <Button
                        disabled={reindexingId !== null}
                        onClick={() => onReindex(document)}
                        variant="secondary"
                      >
                        <RefreshCw aria-hidden="true" size={15} />
                        {reindexingId === document.id ? "Queuing…" : reindexLabel}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button onClick={() => onDelete(document)} variant="danger">
                        <Trash2 aria-hidden="true" size={15} />Delete
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
