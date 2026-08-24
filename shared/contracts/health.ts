import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  service: z.literal("researchweave-api"),
  database: z.enum(["ok", "unavailable"]),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
