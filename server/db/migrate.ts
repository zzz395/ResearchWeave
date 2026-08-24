import "dotenv/config";

import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { loadEnvironment } from "../config/env";
import { createLogger } from "../config/logger";
import { createDatabase } from "./client";

const environment = loadEnvironment();
const logger = createLogger(environment);
const database = createDatabase(environment.DATABASE_URL);

try {
  await migrate(database.db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  logger.info("database migrations completed");
} catch (error: unknown) {
  logger.error(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "database migration failed",
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
