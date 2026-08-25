import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { healthResponseSchema } from "../../shared/contracts/health";
import { createTestApp } from "../helpers/create-test-app";

describe("GET /api/v1/health", () => {
  it("returns a healthy response after a successful database probe", async () => {
    const { app } = createTestApp();

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
    const { app } = createTestApp(() => Promise.reject(new Error("database offline")));

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
    const { app } = createTestApp();

    const response = await request(app).get("/api/v1/not-a-route").expect(404);
    const envelope = errorEnvelopeSchema.parse(response.body);

    expect(envelope.error).toMatchObject({ code: "not_found" });
    expect(JSON.stringify(envelope)).not.toContain("stack");
  });
});
