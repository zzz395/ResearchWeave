import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { healthResponseSchema } from "../../shared/contracts/health";

const testEnvironment: Environment = {
  NODE_ENV: "test",
  PORT: 3001,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLIENT_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "silent",
};

const logger = pino({ level: "silent" });

describe("GET /api/v1/health", () => {
  it("returns a healthy response after a successful database probe", async () => {
    const app = createApp({
      environment: testEnvironment,
      logger,
      checkDatabase: () => Promise.resolve(),
    });

    const response = await request(app).get("/api/v1/health").expect(200);
    const result = healthResponseSchema.safeParse(response.body);

    expect(result.success).toBe(true);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "researchweave-api",
      database: "ok",
    });
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
  });

  it("returns unavailable when the real database boundary fails", async () => {
    const app = createApp({
      environment: testEnvironment,
      logger,
      checkDatabase: () => Promise.reject(new Error("database offline")),
    });

    const response = await request(app).get("/api/v1/health").expect(503);

    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({
      status: "unavailable",
      database: "unavailable",
    });
  });
});

describe("backend error envelope", () => {
  it("returns a sanitized versioned-API 404", async () => {
    const app = createApp({
      environment: testEnvironment,
      logger,
      checkDatabase: () => Promise.resolve(),
    });

    const response = await request(app).get("/api/v1/not-a-route").expect(404);
    const envelope = errorEnvelopeSchema.parse(response.body);

    expect(envelope.error).toMatchObject({ code: "not_found" });
    expect(JSON.stringify(envelope)).not.toContain("stack");
  });
});
