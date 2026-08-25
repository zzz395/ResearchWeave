import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  asChild?: boolean;
}

export function Button({
  variant = "primary",
  asChild = false,
  className = "",
  children,
  ...props
}: PropsWithChildren<ButtonProps>) {
  const Component = asChild ? Slot : "button";
  return (
    <Component className={`rw-button rw-button--${variant} ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
