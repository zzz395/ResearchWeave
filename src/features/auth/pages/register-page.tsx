import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { registerInputSchema } from "../../../../shared/contracts/auth";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { InputField } from "../../../components/ui/form-field";
import { ApiClientError } from "../../../services/api/client";
import { register } from "../api/auth";
import { useAuth } from "../auth-state";
import { AuthLayout } from "../components/auth-layout";
import { PasswordControl } from "../components/password-control";

export function Component() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { setAuthenticatedUser } = useAuth();
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: register });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const parsed = registerInputSchema.safeParse({
      displayName: form.get("displayName"),
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        displayName: fields.displayName?.[0] ?? "",
        email: fields.email?.[0] ?? "",
        password: fields.password?.[0] ?? "",
      });
      return;
    }

    try {
      const user = await mutation.mutateAsync(parsed.data);
      setAuthenticatedUser(user);
      void navigate("/spaces", { replace: true });
    } catch {
      // The mutation error is rendered below without clearing the form.
    }
  }

  const requestError = mutation.error instanceof ApiClientError ? mutation.error : null;

  return (
    <AuthLayout>
      <div className="rw-auth-form-wrap">
        <div className="rw-page-kicker">Begin a research record</div>
        <h1>Create your account</h1>
        <p>Set up a secure identity for your shared research spaces.</p>
        <form className="rw-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          {requestError ? (
            <Alert>
              <strong>Account creation failed.</strong>
              <span>{requestError.message}</span>
            </Alert>
          ) : null}
          <InputField
            autoComplete="name"
            autoFocus
            error={fieldErrors.displayName}
            id="displayName"
            label="Display name"
            name="displayName"
            required
          />
          <InputField
            autoComplete="email"
            error={fieldErrors.email}
            id="email"
            label="Email"
            name="email"
            required
            type="email"
          />
          <PasswordControl
            autoComplete="new-password"
            error={fieldErrors.password}
            hint="10+ characters · 72 bytes max"
          />
          <Button className="rw-form__submit" disabled={mutation.isPending} type="submit">
            {mutation.isPending ? <LoadingLabel>Creating account</LoadingLabel> : "Create account"}
          </Button>
        </form>
        <p className="rw-auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
