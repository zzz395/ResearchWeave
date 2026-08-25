import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  updateSpaceInputSchema,
  type UpdateSpaceInput,
} from "../../../../shared/contracts/spaces";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { InputField, TextareaField } from "../../../components/ui/form-field";
import { ApiClientError } from "../../../services/api/client";
import { deleteSpace, getSpace, updateSpace } from "../api/spaces";
import { Breadcrumb, ContentSection, PageHeader } from "../components/space-page";

export function Component() {
  const { spaceId = "" } = useParams();
  const navigate = useNavigate();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const spaceQuery = useQuery({
    queryKey: ["spaces", spaceId],
    queryFn: () => getSpace(spaceId),
    enabled: Boolean(spaceId),
  });
  const updateMutation = useMutation({
    mutationFn: (input: UpdateSpaceInput) => updateSpace(spaceId, input),
  });
  const deleteMutation = useMutation({ mutationFn: () => deleteSpace(spaceId) });

  if (spaceQuery.isPending) return <PageLoading label="Loading space settings" />;
  if (spaceQuery.error || !spaceQuery.data) {
    const error = spaceQuery.error instanceof ApiClientError ? spaceQuery.error : null;
    return <ErrorPanel message={error?.message ?? "Space settings could not be loaded."} requestId={error?.requestId} />;
  }
  const space = spaceQuery.data;
  if (space.role !== "owner") {
    return (
      <ContentSection>
        <Breadcrumb current="Settings" />
        <ErrorPanel
          title="Owner access required"
          message="You can view this space, but only its owner can change settings or delete it."
        />
        <Button asChild variant="secondary"><Link to={`/spaces/${space.id}`}>Return to space</Link></Button>
      </ContentSection>
    );
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const parsed = updateSpaceInputSchema.safeParse({
      name: form.get("name"),
      description: form.get("description"),
    });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({ name: fields.name?.[0] ?? "", description: fields.description?.[0] ?? "" });
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync(parsed.data);
      queryClient.setQueryData(["spaces", spaceId], updated);
      await queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
      setSaved(true);
    } catch {
      // The server error is displayed without clearing the editable values.
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync();
      queryClient.removeQueries({ queryKey: ["spaces", spaceId] });
      await queryClient.invalidateQueries({ queryKey: ["spaces"], exact: true });
      void navigate("/spaces", { replace: true });
    } catch {
      // The confirmation remains open with the real error available.
    }
  }

  const updateError = updateMutation.error instanceof ApiClientError ? updateMutation.error : null;
  const deleteError = deleteMutation.error instanceof ApiClientError ? deleteMutation.error : null;

  return (
    <ContentSection>
      <Breadcrumb current={`${space.name} settings`} />
      <PageHeader
        description="Maintain the name and purpose collaborators see for this space."
        kicker="Owner controls"
        title="Space settings"
      />
      <section className="rw-form-panel">
        <div className="rw-section-heading">
          <div><h2>Space details</h2><p>Changes are visible anywhere this space is listed.</p></div>
          {saved ? <span className="rw-save-status" role="status"><Check aria-hidden="true" size={16} />Saved</span> : null}
        </div>
        <form className="rw-form" noValidate onSubmit={(event) => void handleUpdate(event)}>
          {updateError ? <Alert><strong>Changes were not saved.</strong><span>{updateError.message}</span></Alert> : null}
          <InputField defaultValue={space.name} error={fieldErrors.name} id="name" label="Name" maxLength={80} name="name" required />
          <TextareaField
            defaultValue={space.description ?? ""}
            error={fieldErrors.description}
            hint="Optional · 1,000 characters max"
            id="description"
            label="Description"
            maxLength={1000}
            name="description"
            rows={5}
          />
          <div className="rw-form-actions">
            <Button disabled={updateMutation.isPending} type="submit">
              {updateMutation.isPending ? <LoadingLabel>Saving changes</LoadingLabel> : "Save changes"}
            </Button>
            <Button asChild variant="secondary"><Link to={`/spaces/${space.id}`}>Cancel</Link></Button>
          </div>
        </form>
      </section>

      <section className="rw-danger-zone">
        <div><p className="rw-page-kicker">Danger zone</p><h2>Delete this research space</h2></div>
        <p>This permanently removes the space and all of its membership records. This action cannot be undone.</p>
        <Dialog.Root onOpenChange={(open) => { if (!open) setConfirmName(""); }}>
          <Dialog.Trigger asChild><Button variant="danger"><Trash2 aria-hidden="true" size={17} />Delete space</Button></Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="rw-dialog-overlay" />
            <Dialog.Content className="rw-dialog-card">
              <div className="rw-dialog-card__heading">
                <div><p className="rw-page-kicker">Permanent action</p><Dialog.Title>Delete “{space.name}”?</Dialog.Title></div>
                <Dialog.Close className="rw-icon-button" aria-label="Close confirmation"><X aria-hidden="true" size={20} /></Dialog.Close>
              </div>
              <Dialog.Description>
                Type <strong>{space.name}</strong> to confirm. The space and its membership records will be permanently deleted.
              </Dialog.Description>
              {deleteError ? <Alert><strong>Deletion failed.</strong><span>{deleteError.message}</span></Alert> : null}
              <InputField
                autoComplete="off"
                id="confirmSpaceName"
                label="Space name"
                onChange={(event) => setConfirmName(event.target.value)}
                value={confirmName}
              />
              <div className="rw-form-actions rw-form-actions--end">
                <Dialog.Close asChild><Button variant="secondary">Keep space</Button></Dialog.Close>
                <Button
                  disabled={confirmName !== space.name || deleteMutation.isPending}
                  onClick={() => void handleDelete()}
                  variant="danger"
                >
                  {deleteMutation.isPending ? <LoadingLabel>Deleting space</LoadingLabel> : "Delete permanently"}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    </ContentSection>
  );
}
