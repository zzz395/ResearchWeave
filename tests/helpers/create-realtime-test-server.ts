import { createServer } from "node:http";

import pino from "pino";

import { createApp } from "../../server/app";
import { createAuthService } from "../../server/modules/auth/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import { createMemberService } from "../../server/modules/members/service";
import { createResearchService } from "../../server/modules/research/service";
import { createSpaceService, type SpaceService } from "../../server/modules/spaces/service";
import { attachRealtimeGateway } from "../../server/realtime/gateway";
import { RealtimeHub } from "../../server/realtime/hub";
import { testEnvironment } from "./create-test-app";
import {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryMemberRepository,
  InMemoryPaperRepository,
  InMemoryPaperSummaryRepository,
  InMemorySavedPaperRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

export async function createRealtimeTestServer() {
  const authRepository = new InMemoryAuthRepository();
  const spaceRepository = new InMemorySpaceRepository();
  const connectionRepository = new InMemoryConnectionRepository(authRepository);
  const memberRepository = new InMemoryMemberRepository(authRepository, spaceRepository);
  const chatRepository = new InMemoryChatRepository(authRepository);
  const paperRepository = new InMemoryPaperRepository();
  const savedPaperRepository = new InMemorySavedPaperRepository(
    paperRepository,
    spaceRepository,
  );
  const summaryRepository = new InMemoryPaperSummaryRepository(paperRepository);
  const hub = new RealtimeHub();
  const authService = createAuthService(authRepository, {
    sessionEnded: (tokenHash) => hub.closeSession(tokenHash),
  });
  const spaceService = createSpaceService(spaceRepository, {
    spaceDeleted: (spaceId) => hub.revokeSpace(spaceId),
  });
  const authorizationPauses: Array<{ reached: Deferred; release: Deferred }> = [];
  const gatewaySpaceService: SpaceService = {
    ...spaceService,
    async getSpace(spaceId, userId) {
      const space = await spaceService.getSpace(spaceId, userId);
      const pause = authorizationPauses.shift();
      if (pause) {
        pause.reached.resolve();
        await pause.release.promise;
      }
      return space;
    },
  };
  const connectionService = createConnectionService(connectionRepository);
  const memberService = createMemberService(
    memberRepository,
    spaceRepository,
    connectionRepository,
    { memberRemoved: (spaceId, userId) => hub.revokeMember(spaceId, userId) },
  );
  const chatService = createChatService(chatRepository, spaceRepository);
  const researchService = createResearchService(
    paperRepository,
    savedPaperRepository,
    {
      search: () =>
        Promise.resolve({ totalResults: 0, startIndex: 0, itemsPerPage: 0, papers: [] }),
    },
    summaryRepository,
  );
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
    researchService,
  });
  const server = createServer(app);
  const gateway = attachRealtimeGateway({
    server,
    environment: testEnvironment,
    logger,
    authService,
    spaceService: gatewaySpaceService,
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
    hub,
    memberService,
    spaceService,
    pauseNextSpaceAuthorization() {
      const reached = createDeferred();
      const release = createDeferred();
      authorizationPauses.push({ reached, release });
      return { reached: reached.promise, release: () => release.resolve() };
    },
    async close() {
      await gateway.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
