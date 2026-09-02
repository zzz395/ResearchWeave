import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookmarkPlus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { PersistentResearchPaper } from "../../../../shared/contracts/research";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { listSpaces } from "../../spaces/api/spaces";
import { savePaperToSpace } from "../api/research";
import { researchQueryKeys } from "../api/query-keys";
import {
  beginSavePaperWorkflow,
  completeSavePaperWorkflow,
  getResearchWorkflowRoutes,
  type ResearchWorkflowSpace,
} from "../research-workflow";

export function SavePaperDialog({ paper }: { paper: PersistentResearchPaper }) {
  const [open, setOpen] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [savedSpace, setSavedSpace] = useState<ResearchWorkflowSpace | null>(null);
  const spacesQuery = useQuery({
    queryKey: ["spaces"],
    queryFn: listSpaces,
    enabled: open,
  });
  const saveMutation = useMutation({
    mutationFn: (spaceId: string) => savePaperToSpace(spaceId, paper.id),
  });

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      const initialState = beginSavePaperWorkflow();
      setSelectedSpaceId(initialState.selectedSpaceId);
      setSavedSpace(initialState.savedSpace);
      saveMutation.reset();
    }
  }

  async function handleSave() {
    const space = spacesQuery.data?.find(({ id }) => id === selectedSpaceId);
    if (!space) return;
    try {
      await saveMutation.mutateAsync(space.id);
      await queryClient.invalidateQueries({
        queryKey: researchQueryKeys.savedPapers(space.id),
        exact: true,
      });
      setSavedSpace(completeSavePaperWorkflow(space));
      setOpen(false);
    } catch {
      // The dialog keeps the chosen Space available for a truthful retry.
    }
  }

  const mutationError = saveMutation.error instanceof ApiClientError ? saveMutation.error : null;
  const continuationRoutes = savedSpace ? getResearchWorkflowRoutes(savedSpace.id) : null;

  return (
    <div className="rw-save-paper-action">
      <Dialog.Root onOpenChange={handleOpenChange} open={open}>
        <Dialog.Trigger asChild>
          <Button>
            <BookmarkPlus aria-hidden="true" size={16} />Save to Space
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="rw-dialog-overlay" />
          <Dialog.Content aria-modal="true" className="rw-dialog-card">
            <div className="rw-dialog-card__heading">
              <Dialog.Title>Save paper to a Space</Dialog.Title>
              <Dialog.Close className="rw-icon-button" aria-label="Close save dialog">
                <X aria-hidden="true" size={19} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Choose one Research Space for <strong>{paper.title}</strong>.
            </Dialog.Description>
            {mutationError ? (
              <Alert>
                <strong>Paper could not be saved.</strong>
                <span>{mutationError.message}</span>
              </Alert>
            ) : null}
            {spacesQuery.isPending ? <LoadingLabel>Loading your Spaces</LoadingLabel> : null}
            {spacesQuery.error ? (
              <Alert>
                <strong>Spaces could not be loaded.</strong>
                <span>Close the dialog and try again.</span>
              </Alert>
            ) : null}
            {spacesQuery.data?.length === 0 ? (
              <div className="rw-dialog-empty">
                <p>You do not have a Research Space yet.</p>
                <Button asChild variant="secondary"><Link to="/spaces/new">Create a Space</Link></Button>
              </div>
            ) : null}
            {spacesQuery.data && spacesQuery.data.length > 0 ? (
              <fieldset className="rw-space-picker">
                <legend>Select a Space</legend>
                {spacesQuery.data.map((space) => (
                  <label key={space.id}>
                    <input
                      checked={selectedSpaceId === space.id}
                      name={`save-paper-${paper.id}`}
                      onChange={() => setSelectedSpaceId(space.id)}
                      type="radio"
                      value={space.id}
                    />
                    <span><strong>{space.name}</strong><small>{space.role}</small></span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {spacesQuery.data && spacesQuery.data.length > 0 ? (
              <div className="rw-form-actions rw-form-actions--end">
                <Dialog.Close asChild><Button variant="secondary">Cancel</Button></Dialog.Close>
                <Button
                  disabled={!selectedSpaceId || saveMutation.isPending}
                  onClick={() => void handleSave()}
                >
                  {saveMutation.isPending ? "Saving…" : "Save paper"}
                </Button>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {savedSpace && continuationRoutes ? (
        <div className="rw-save-confirmation">
          <p role="status">Saved to <strong>{savedSpace.name}</strong>.</p>
          <div>
            <Button asChild variant="secondary">
              <Link to={continuationRoutes.savedPapers}>View Saved Papers</Link>
            </Button>
            <Button asChild>
              <Link to={continuationRoutes.knowledge}>Continue in Knowledge</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
