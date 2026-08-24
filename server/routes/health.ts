import { Router } from "express";
import type { Logger } from "pino";

import type { HealthResponse } from "../../shared/contracts/health";
import type { DatabaseHealthCheck } from "../types/health";

interface HealthRouterDependencies {
  checkDatabase: DatabaseHealthCheck;
  logger: Logger;
}

export function createHealthRouter({ checkDatabase, logger }: HealthRouterDependencies) {
  const router = Router();

  router.get("/health", async (_request, response) => {
    const timestamp = new Date().toISOString();

    try {
      await checkDatabase();
      const body: HealthResponse = {
        status: "ok",
        service: "researchweave-api",
        database: "ok",
        timestamp,
      };
      response.status(200).json(body);
    } catch (error: unknown) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "database health check failed",
      );
      const body: HealthResponse = {
        status: "unavailable",
        service: "researchweave-api",
        database: "unavailable",
        timestamp,
      };
      response.status(503).json(body);
    }
  });

  return router;
}
