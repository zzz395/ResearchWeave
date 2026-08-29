import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { FileUp, Upload, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";

import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { uploadDocument } from "../api/documents";
import { documentQueryKeys } from "../api/query-keys";
import { validateDocumentFile } from "../document-presentation";

export function DocumentUploadDialog({
  spaceId,
  onUploaded,
}: {
  spaceId: string;
  onUploaded: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useMutation({
    mutationFn: (selected: File) => uploadDocument(spaceId, selected),
  });

  function reset() {
    setFile(null);
    setValidationError(null);
    uploadMutation.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen || !uploadMutation.isPending) reset();
  }

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const error = validateDocumentFile(nextFile);
    setValidationError(error);
    setFile(error ? null : nextFile);
    uploadMutation.reset();
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!file) return;
    try {
      const result = await uploadMutation.mutateAsync(file);
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.list(spaceId),
        exact: true,
      });
      onUploaded(
        result.created
          ? "Document uploaded and queued for indexing."
          : "This document already exists in the Knowledge Base.",
      );
      setOpen(false);
      reset();
    } catch {
      // Keep the selected file available for a truthful retry.
    }
  }

  const mutationError = uploadMutation.error instanceof ApiClientError
    ? uploadMutation.error
    : null;

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger asChild>
        <Button><Upload aria-hidden="true" size={16} />Upload document</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="rw-dialog-overlay" />
        <Dialog.Content className="rw-dialog-card rw-document-upload-dialog">
          <div className="rw-dialog-card__heading">
            <div>
              <p className="rw-page-kicker">Durable source upload</p>
              <Dialog.Title>Upload a document</Dialog.Title>
            </div>
            <Dialog.Close className="rw-icon-button" aria-label="Close upload dialog">
              <X aria-hidden="true" size={19} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Add one PDF, TXT, MD, or Markdown file up to 20 MB. Uploading stores the source;
            indexing continues separately in the background.
          </Dialog.Description>
          {validationError ? <Alert><strong>Choose another file.</strong><span>{validationError}</span></Alert> : null}
          {mutationError ? (
            <Alert>
              <strong>Document could not be uploaded.</strong>
              <span>{mutationError.message}</span>
            </Alert>
          ) : null}
          <label
            className="rw-document-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,text/x-markdown"
              onChange={handleInput}
              ref={inputRef}
              type="file"
            />
            <FileUp aria-hidden="true" size={24} />
            <span><strong>{file ? file.name : "Choose a document"}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB selected` : "Browse or drop a single file here"}</small></span>
          </label>
          <p className="rw-document-upload-note">
            A successful upload appears as Queued. Ready is shown only after durable indexing completes.
          </p>
          <div className="rw-form-actions rw-form-actions--end">
            <Dialog.Close asChild><Button disabled={uploadMutation.isPending} variant="secondary">Cancel</Button></Dialog.Close>
            <Button disabled={!file || uploadMutation.isPending} onClick={() => void handleUpload()}>
              {uploadMutation.isPending ? <LoadingLabel>Uploading document</LoadingLabel> : "Upload and queue"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
