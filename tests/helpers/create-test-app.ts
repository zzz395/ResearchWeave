import pino from "pino";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { createAuthService } from "../../server/modules/auth/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import { createMemberService } from "../../server/modules/members/service";
import { createSpaceService } from "../../server/modules/spaces/service";
import {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryMemberRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";

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
  const connectionRepository = new InMemoryConnectionRepository(authRepository);
  const memberRepository = new InMemoryMemberRepository(authRepository, spaceRepository);
  const chatRepository = new InMemoryChatRepository(authRepository);
  const authService = createAuthService(authRepository);
  const spaceService = createSpaceService(spaceRepository);
  const connectionService = createConnectionService(connectionRepository);
  const memberService = createMemberService(memberRepository, spaceRepository, connectionRepository);
  const chatService = createChatService(chatRepository, spaceRepository);
  const app = createApp({
    environment: testEnvironment,
    logger: pino({ level: "silent" }),
    checkDatabase,
    authService,
    spaceService,
    connectionService,
    memberService,
    chatService,
  });

  return {
    app,
    authRepository,
    spaceRepository,
    connectionRepository,
    memberRepository,
    chatRepository,
    authService,
    spaceService,
    chatService,
  };
}
