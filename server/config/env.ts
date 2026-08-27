import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must use the postgres or postgresql protocol",
    ),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().trim().min(1).optional(),
  LLM_MODEL: z.string().trim().min(1).optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join(".") || "environment")
      .filter((field, index, allFields) => allFields.indexOf(field) === index)
      .join(", ");

    throw new Error(`Invalid environment configuration. Check: ${fields}`);
  }

  return result.data;
}
