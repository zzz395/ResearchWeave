import pino, { type Logger } from "pino";

import type { Environment } from "./env";

export function createLogger(environment: Environment): Logger {
  return pino({
    level: environment.LOG_LEVEL,
    base: {
      service: "researchweave-api",
      environment: environment.NODE_ENV,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "password",
        "token",
        "apiKey",
        "authorization",
        "cookie",
      ],
      censor: "[REDACTED]",
    },
  });
}
