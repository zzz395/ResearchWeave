import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function FieldFrame({ id, label, hint, error, children }: FieldFrameProps) {
  return (
    <div className="rw-field">
      <div className="rw-field__label-row">
        <label htmlFor={id}>{label}</label>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="rw-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  trailing?: React.ReactNode;
}

export function InputField({ label, hint, error, trailing, className = "", ...props }: InputFieldProps) {
  const describedBy = error ? `${props.id}-error` : props["aria-describedby"];
  return (
    <FieldFrame id={props.id} label={label} hint={hint} error={error}>
      <div className="rw-field__control">
        <input
          {...props}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`rw-input ${className}`.trim()}
        />
        {trailing}
      </div>
    </FieldFrame>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

export function TextareaField({ label, hint, error, className = "", ...props }: TextareaFieldProps) {
  return (
    <FieldFrame id={props.id} label={label} hint={hint} error={error}>
      <textarea
        {...props}
        aria-describedby={error ? `${props.id}-error` : props["aria-describedby"]}
        aria-invalid={Boolean(error)}
        className={`rw-input rw-textarea ${className}`.trim()}
      />
    </FieldFrame>
  );
}
