import pino, { type Logger } from "pino";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { createAuthService } from "../../server/modules/auth/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import {
  createDocumentUploadMiddleware,
  type DocumentUploadMiddlewareOptions,
} from "../../server/integrations/document-upload/middleware";
import type { DocumentStorage } from "../../server/integrations/document-storage/storage";
import { createDocumentService } from "../../server/modules/documents/service";
import { createMemberService } from "../../server/modules/members/service";
import type { ArxivClient } from "../../server/integrations/arxiv/client";
import type { ResearchSummaryGenerator } from "../../server/integrations/research-summary/generator";
import { createResearchService } from "../../server/modules/research/service";
import { createSpaceService } from "../../server/modules/spaces/service";
import {
  InMemoryAuthRepository,
  InMemoryChatRepository,
  InMemoryConnectionRepository,
  InMemoryDocumentRepository,
  InMemoryDocumentStorage,
  InMemoryMemberRepository,
  InMemoryPaperRepository,
  InMemoryPaperSummaryRepository,
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
  DOCUMENT_STORAGE_DIR: "./data/documents-test",
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
  summaryGenerator?: ResearchSummaryGenerator,
  documentStorage: DocumentStorage = new InMemoryDocumentStorage(),
  documentUploadOptions: DocumentUploadMiddlewareOptions = {},
  logger: Logger = pino({ level: "silent" }),
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
  const summaryRepository = new InMemoryPaperSummaryRepository(paperRepository);
  const documentRepository = new InMemoryDocumentRepository(spaceRepository);
  const authService = createAuthService(authRepository);
  const spaceService = createSpaceService(spaceRepository);
  const connectionService = createConnectionService(connectionRepository);
  const memberService = createMemberService(memberRepository, spaceRepository, connectionRepository);
  const chatService = createChatService(chatRepository, spaceRepository);
  const researchService = createResearchService(
    paperRepository,
    savedPaperRepository,
    arxivClient,
    summaryRepository,
    summaryGenerator,
  );
  const documentService = createDocumentService(documentRepository, documentStorage, logger);
  const documentUploadMiddleware = createDocumentUploadMiddleware(
    documentStorage,
    logger,
    documentUploadOptions,
  );
  const app = createApp({
    environment: testEnvironment,
    logger,
    checkDatabase,
    authService,
    spaceService,
    connectionService,
    memberService,
    chatService,
    researchService,
    documentService,
    documentUploadMiddleware,
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
    summaryRepository,
    documentRepository,
    documentStorage,
    authService,
    spaceService,
    chatService,
    researchService,
    documentService,
  };
}
