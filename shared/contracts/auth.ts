import { z } from "zod";

const passwordBytes = new TextEncoder();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(80, "Use no more than 80 characters.");
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use no more than 128 characters.")
  .refine((password) => passwordBytes.encode(password).byteLength <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes.",
  });

export const registerInputSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  displayName: displayNameSchema,
  createdAt: z.string().datetime(),
});

export const authResponseSchema = z.object({
  user: userSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type User = z.infer<typeof userSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
