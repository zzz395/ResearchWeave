import pino from "pino";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { createAuthService } from "../../server/modules/auth/service";
import { createSpaceService } from "../../server/modules/spaces/service";
import { InMemoryAuthRepository, InMemorySpaceRepository } from "./in-memory-repositories";

export const testEnvironment: Environment = {
  NODE_ENV: "test",
  PORT: 3001,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLIENT_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "silent",
};

export function createTestApp(checkDatabase: () => Promise<void> = () => Promise.resolve()) {
  const authRepository = new InMemoryAuthRepository();
  const spaceRepository = new InMemorySpaceRepository();
  const authService = createAuthService(authRepository);
  const spaceService = createSpaceService(spaceRepository);
  const app = createApp({
    environment: testEnvironment,
    logger: pino({ level: "silent" }),
    checkDatabase,
    authService,
    spaceService,
  });

  return { app, authRepository, spaceRepository };
}
