import path from "node:path";

import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";

import type { Environment } from "./config/env";
import { createErrorHandler, createNotFoundHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import { createRequestLogger } from "./middleware/request-logger";
import { createHealthRouter } from "./routes/health";
import type { DatabaseHealthCheck } from "./types/health";

export interface AppDependencies {
  environment: Environment;
  logger: Logger;
  checkDatabase: DatabaseHealthCheck;
}

export function createApp({ environment, logger, checkDatabase }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: environment.CLIENT_ORIGIN,
      credentials: false,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(requestIdMiddleware);
  app.use(createRequestLogger(logger));

  app.use("/api/v1", createHealthRouter({ checkDatabase, logger }));

  if (environment.NODE_ENV === "production") {
    const clientDirectory = path.resolve(process.cwd(), "dist/client");
    const clientEntry = path.join(clientDirectory, "index.html");

    app.use(express.static(clientDirectory, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.sendFile(clientEntry, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
