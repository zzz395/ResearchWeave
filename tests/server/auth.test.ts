import request from "supertest";
import { describe, expect, it } from "vitest";

import { authResponseSchema } from "../../shared/contracts/auth";
import { errorEnvelopeSchema } from "../../shared/contracts/error";
import { hashSessionToken } from "../../server/modules/auth/service";
import { createTestApp, testEnvironment } from "../helpers/create-test-app";

const validRegistration = {
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  password: "analytical-engine",
};

describe("authentication API", () => {
  it("registers a normalized account and stores only password/session hashes", async () => {
    const { app, authRepository } = createTestApp();
    const response = await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ ...validRegistration, email: "  ADA@Example.COM " })
      .expect(201);

    const result = authResponseSchema.parse(response.body);
    expect(result.user.email).toBe("ada@example.com");
    expect(response.body).not.toHaveProperty("password");
    expect(JSON.stringify(response.body)).not.toContain(validRegistration.password);

    const [storedUser] = [...authRepository.users.values()];
    expect(storedUser?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(storedUser?.passwordHash).not.toContain(validRegistration.password);

    const cookie = response.headers["set-cookie"]?.[0];
    expect(cookie).toContain("researchweave_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=");

    const token = cookie?.match(/researchweave_session=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(authRepository.sessions.has(hashSessionToken(token ?? ""))).toBe(true);
    expect([...authRepository.sessions.keys()]).not.toContain(token);
  });

  it("rejects duplicate normalized emails and invalid password lengths", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send(validRegistration)
      .expect(201);

    const duplicate = await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ ...validRegistration, email: "ADA@EXAMPLE.COM" })
      .expect(409);
    expect(errorEnvelopeSchema.parse(duplicate.body).error.code).toBe("email_already_exists");

    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ ...validRegistration, email: "short@example.com", password: "too-short" })
      .expect(400);

    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ ...validRegistration, email: "bytes@example.com", password: "研".repeat(25) })
      .expect(400);
  });

  it("returns the same generic error for unknown email and wrong password", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send(validRegistration)
      .expect(201);

    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ email: "unknown@example.com", password: "wrong-password" })
      .expect(401);
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ email: validRegistration.email, password: "wrong-password" })
      .expect(401);

    const unknownError = errorEnvelopeSchema.parse(unknown.body).error;
    const wrongError = errorEnvelopeSchema.parse(wrong.body).error;
    expect(unknownError.code).toBe("invalid_credentials");
    expect(wrongError).toMatchObject({
      code: unknownError.code,
      message: unknownError.message,
    });
  });

  it("restores a session, expires stale sessions, and invalidates logout", async () => {
    const { app, authRepository } = createTestApp();
    const agent = request.agent(app);
    await agent
      .post("/api/v1/auth/register")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send(validRegistration)
      .expect(201);
    await agent.get("/api/v1/auth/session").expect(200);

    const [session] = [...authRepository.sessions.values()];
    expect(session).toBeDefined();
    if (session) session.expiresAt = new Date(0);
    const expired = await agent.get("/api/v1/auth/session").expect(401);
    expect(expired.headers["set-cookie"]?.[0]).toContain("researchweave_session=;");

    const secondAgent = request.agent(app);
    await secondAgent
      .post("/api/v1/auth/login")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .send({ email: validRegistration.email, password: validRegistration.password })
      .expect(200);
    await secondAgent
      .post("/api/v1/auth/logout")
      .set("Origin", testEnvironment.CLIENT_ORIGIN)
      .expect(204);
    await secondAgent.get("/api/v1/auth/session").expect(401);
  });

  it("rejects state-changing requests without the trusted Origin", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(validRegistration)
      .expect(403);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("origin_not_allowed");
  });
});
