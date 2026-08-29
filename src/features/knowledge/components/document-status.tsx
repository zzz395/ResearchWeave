import type { Document } from "../../../../shared/contracts/documents";
import {
  getActiveIndexPresentation,
  getDocumentStatusPresentation,
} from "../document-presentation";

export function DocumentStatus({ document }: { document: Document }) {
  const status = getDocumentStatusPresentation(document);
  const activeIndex = getActiveIndexPresentation(document);
  return (
    <div className="rw-document-status">
      <span className={`rw-status-badge rw-status-badge--${status.tone}`}>{status.primary}</span>
      <span>{status.secondary}</span>
      <span className={activeIndex.available ? "is-available" : ""}>
        {activeIndex.label}
      </span>
    </div>
  );
}
