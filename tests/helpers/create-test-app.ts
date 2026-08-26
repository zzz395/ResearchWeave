import pino from "pino";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { createAuthService } from "../../server/modules/auth/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import { createMemberService } from "../../server/modules/members/service";
import type { ArxivClient } from "../../server/integrations/arxiv/client";
import { createResearchService } from "../../server/modules/research/service";
import { createSpaceService } from "../../server/modules/spaces/service";
import {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryMemberRepository,
  InMemoryPaperRepository,
  InMemorySavedPaperRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";
import type { ResearchPaperSearchResult } from "../../shared/contracts/research";

export const testEnvironment: Environment = {
  NODE_ENV: "test",
  PORT: 3001,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLIENT_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "silent",
};

const emptyArxivClient: Pick<ArxivClient, "search"> = {
  search: () =>
    Promise.resolve({
      totalResults: 0,
      startIndex: 0,
      itemsPerPage: 0,
      papers: [],
    } satisfies ResearchPaperSearchResult),
};

export function createTestApp(
  checkDatabase: () => Promise<void> = () => Promise.resolve(),
  arxivClient: Pick<ArxivClient, "search"> = emptyArxivClient,
) {
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
  const authService = createAuthService(authRepository);
  const spaceService = createSpaceService(spaceRepository);
  const connectionService = createConnectionService(connectionRepository);
  const memberService = createMemberService(memberRepository, spaceRepository, connectionRepository);
  const chatService = createChatService(chatRepository, spaceRepository);
  const researchService = createResearchService(
    paperRepository,
    savedPaperRepository,
    arxivClient,
  );
  const app = createApp({
    environment: testEnvironment,
    logger: pino({ level: "silent" }),
    checkDatabase,
    authService,
    spaceService,
    connectionService,
    memberService,
    chatService,
    researchService,
  });

  return {
    app,
    authRepository,
    spaceRepository,
    connectionRepository,
    memberRepository,
    chatRepository,
    paperRepository,
    savedPaperRepository,
    authService,
    spaceService,
    chatService,
    researchService,
  };
}
