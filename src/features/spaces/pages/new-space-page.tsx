import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createSpaceInputSchema } from "../../../../shared/contracts/spaces";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { InputField, TextareaField } from "../../../components/ui/form-field";
import { queryClient } from "../../../app/query-client";
import { ApiClientError } from "../../../services/api/client";
import { createSpace } from "../api/spaces";
import { Breadcrumb, ContentSection, PageHeader } from "../components/space-page";

export function Component() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: createSpace });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const parsed = createSpaceInputSchema.safeParse({
      name: form.get("name"),
      description: form.get("description"),
    });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({ name: fields.name?.[0] ?? "", description: fields.description?.[0] ?? "" });
      return;
    }
    try {
      const space = await mutation.mutateAsync(parsed.data);
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      queryClient.setQueryData(["spaces", space.id], space);
      void navigate(`/spaces/${space.id}`);
    } catch {
      // The real request error remains visible and the form stays intact.
    }
  }

  const requestError = mutation.error instanceof ApiClientError ? mutation.error : null;
  return (
    <ContentSection>
      <Breadcrumb current="New space" />
      <PageHeader
        description="Give the space a precise name and enough context for collaborators to understand its scope."
        kicker="New research space"
        title="Create a shared context"
      />
      <section className="rw-form-panel">
        <form className="rw-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          {requestError ? <Alert><strong>Space creation failed.</strong><span>{requestError.message}</span></Alert> : null}
          <InputField autoFocus error={fieldErrors.name} id="name" label="Name" maxLength={80} name="name" required />
          <TextareaField
            error={fieldErrors.description}
            hint="Optional · 1,000 characters max"
            id="description"
            label="Description"
            maxLength={1000}
            name="description"
            rows={5}
          />
          <div className="rw-form-actions">
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? <LoadingLabel>Creating space</LoadingLabel> : "Create space"}
            </Button>
            <Button asChild variant="secondary"><Link to="/spaces">Cancel</Link></Button>
          </div>
        </form>
      </section>
    </ContentSection>
  );
}
