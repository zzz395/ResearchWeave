import { ZodError, type ZodType } from "zod";

import { AppError } from "./app-error";

export function parseResponse<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new AppError(
        500,
        "internal_server_error",
        "The server produced an invalid response.",
      );
    }
    throw error;
  }
}
