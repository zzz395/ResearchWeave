import "dotenv/config";

import { defineConfig } from "drizzle-kit";

import { loadEnvironment } from "./server/config/env";

const environment = loadEnvironment();

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: environment.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
