import "dotenv/config";

import { createServer } from "node:http";

import { createApp } from "./app";
import { loadEnvironment } from "./config/env";
import { createLogger } from "./config/logger";
import { createDatabase } from "./db/client";

const environment = loadEnvironment();
const logger = createLogger(environment);
const database = createDatabase(environment.DATABASE_URL);
const app = createApp({
  environment,
  logger,
  checkDatabase: () => database.checkHealth(),
});
const server = createServer(app);

server.on("error", (error) => {
  logger.fatal({ errorType: error.name }, "HTTP server failed");
  process.exitCode = 1;
});

server.listen(environment.PORT, "0.0.0.0", () => {
  logger.info({ port: environment.PORT }, "ResearchWeave API listening");
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "graceful shutdown started");

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await database.close();
  logger.info("graceful shutdown completed");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
