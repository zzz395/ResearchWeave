import { z } from "zod";

export const spaceNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(80, "Use no more than 80 characters.");
export const spaceDescriptionSchema = z
  .string()
  .trim()
  .max(1000, "Use no more than 1,000 characters.")
  .nullable();

export const createSpaceInputSchema = z.object({
  name: spaceNameSchema,
  description: z
    .string()
    .trim()
    .max(1000, "Use no more than 1,000 characters.")
    .optional()
    .transform((value) => value || null),
});

export const updateSpaceInputSchema = z
  .object({
    name: spaceNameSchema.optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Use no more than 1,000 characters.")
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null)),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "Provide at least one field to update.",
  });

export const spaceRoleSchema = z.enum(["owner", "member"]);

export const researchSpaceSchema = z.object({
  id: z.string().uuid(),
  name: spaceNameSchema,
  description: spaceDescriptionSchema,
  ownerId: z.string().uuid(),
  role: spaceRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const researchSpaceResponseSchema = z.object({
  space: researchSpaceSchema,
});

export const researchSpaceListResponseSchema = z.object({
  spaces: z.array(researchSpaceSchema),
});

export type CreateSpaceInput = z.infer<typeof createSpaceInputSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceInputSchema>;
export type SpaceRole = z.infer<typeof spaceRoleSchema>;
export type ResearchSpace = z.infer<typeof researchSpaceSchema>;
export type ResearchSpaceResponse = z.infer<typeof researchSpaceResponseSchema>;
export type ResearchSpaceListResponse = z.infer<typeof researchSpaceListResponseSchema>;
