import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { InputField } from "../../../components/ui/form-field";

export function PasswordControl({
  error,
  autoComplete,
  hint,
}: {
  error?: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <InputField
      autoComplete={autoComplete}
      error={error}
      hint={hint}
      id="password"
      label="Password"
      name="password"
      required
      trailing={
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="rw-input-action"
          onClick={() => setVisible((value) => !value)}
          type="button"
        >
          {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      }
      type={visible ? "text" : "password"}
    />
  );
}
