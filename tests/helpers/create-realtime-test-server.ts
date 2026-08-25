import { createServer } from "node:http";

import pino from "pino";

import { createApp } from "../../server/app";
import { createAuthService } from "../../server/modules/auth/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import { createMemberService } from "../../server/modules/members/service";
import { createSpaceService } from "../../server/modules/spaces/service";
import { attachRealtimeGateway } from "../../server/realtime/gateway";
import { RealtimeHub } from "../../server/realtime/hub";
import { testEnvironment } from "./create-test-app";
import {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryMemberRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";

export async function createRealtimeTestServer() {
  const authRepository = new InMemoryAuthRepository();
  const spaceRepository = new InMemorySpaceRepository();
  const connectionRepository = new InMemoryConnectionRepository(authRepository);
  const memberRepository = new InMemoryMemberRepository(authRepository, spaceRepository);
  const chatRepository = new InMemoryChatRepository(authRepository);
  const hub = new RealtimeHub();
  const authService = createAuthService(authRepository, {
    sessionEnded: (tokenHash) => hub.closeSession(tokenHash),
  });
  const spaceService = createSpaceService(spaceRepository, {
    spaceDeleted: (spaceId) => hub.revokeSpace(spaceId),
  });
  const connectionService = createConnectionService(connectionRepository);
  const memberService = createMemberService(
    memberRepository,
    spaceRepository,
    connectionRepository,
    { memberRemoved: (spaceId, userId) => hub.revokeMember(spaceId, userId) },
  );
  const chatService = createChatService(chatRepository, spaceRepository);
  const logger = pino({ level: "silent" });
  const app = createApp({
    environment: testEnvironment,
    logger,
    checkDatabase: () => Promise.resolve(),
    authService,
    spaceService,
    connectionService,
    memberService,
    chatService,
  });
  const server = createServer(app);
  const gateway = attachRealtimeGateway({
    server,
    environment: testEnvironment,
    logger,
    authService,
    spaceService,
    chatService,
    hub,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");

  return {
    server,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/api/v1/realtime`,
    authRepository,
    spaceRepository,
    connectionRepository,
    memberRepository,
    chatRepository,
    memberService,
    spaceService,
    async close() {
      await gateway.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
