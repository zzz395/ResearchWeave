import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { loginInputSchema } from "../../../../shared/contracts/auth";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { InputField } from "../../../components/ui/form-field";
import { ApiClientError } from "../../../services/api/client";
import { login } from "../api/auth";
import { useAuth } from "../auth-state";
import { AuthLayout } from "../components/auth-layout";
import { PasswordControl } from "../components/password-control";
import { safeReturnPath } from "../safe-return-path";

export function Component() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [searchParams] = useSearchParams();
  const { setAuthenticatedUser } = useAuth();
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: login });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const parsed = loginInputSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: fields.email?.[0] ?? "",
        password: fields.password?.[0] ?? "",
      });
      return;
    }

    try {
      const user = await mutation.mutateAsync(parsed.data);
      setAuthenticatedUser(user);
      void navigate(safeReturnPath(searchParams.get("returnTo")), { replace: true });
    } catch {
      // The mutation error is rendered below without changing the user's input.
    }
  }

  const requestError = mutation.error instanceof ApiClientError ? mutation.error : null;

  return (
    <AuthLayout>
      <div className="rw-auth-form-wrap">
        <div className="rw-page-kicker">Welcome back</div>
        <h1>Sign in to your workspace</h1>
        <p>Continue to the research spaces shared with you.</p>
        <form className="rw-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          {requestError ? (
            <Alert>
              <strong>Sign in failed.</strong>
              <span>{requestError.message}</span>
            </Alert>
          ) : null}
          <InputField
            autoComplete="email"
            autoFocus
            error={fieldErrors.email}
            id="email"
            label="Email"
            name="email"
            required
            type="email"
          />
          <PasswordControl autoComplete="current-password" error={fieldErrors.password} />
          <Button className="rw-form__submit" disabled={mutation.isPending} type="submit">
            {mutation.isPending ? <LoadingLabel>Signing in</LoadingLabel> : "Sign in"}
          </Button>
        </form>
        <p className="rw-auth-switch">
          New to ResearchWeave? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
