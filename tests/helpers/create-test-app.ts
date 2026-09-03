import pino, { type Logger } from "pino";

import { createApp } from "../../server/app";
import type { Environment } from "../../server/config/env";
import { createAuthService } from "../../server/modules/auth/service";
import { createAgentService } from "../../server/modules/agents/service";
import { createChatService } from "../../server/modules/chat/service";
import { createConnectionService } from "../../server/modules/connections/service";
import {
  createDocumentUploadMiddleware,
  type DocumentUploadMiddlewareOptions,
} from "../../server/integrations/document-upload/middleware";
import type { DocumentStorage } from "../../server/integrations/document-storage/storage";
import { createDocumentService } from "../../server/modules/documents/service";
import {
  UnconfiguredDocumentEmbeddingGenerator,
  type DocumentEmbeddingGenerator,
} from "../../server/modules/documents/document-embedding-generator";
import { createMemberService } from "../../server/modules/members/service";
import type { ArxivClient } from "../../server/integrations/arxiv/client";
import type { ResearchSummaryGenerator } from "../../server/integrations/research-summary/generator";
import type { GroundedAnswerGenerator } from "../../server/integrations/grounded-answer/generator";
import { createGroundedAnswerService } from "../../server/modules/grounded-answer/service";
import { createResearchService } from "../../server/modules/research/service";
import { createSemanticRetrievalService } from "../../server/modules/retrieval/service";
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
  InMemorySemanticRetrievalRepository,
  InMemorySpaceRepository,
} from "./in-memory-repositories";
import { InMemoryAgentRepository } from "./in-memory-agent-repository";
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
  retrievalEmbeddingGenerator: DocumentEmbeddingGenerator =
    new UnconfiguredDocumentEmbeddingGenerator(),
  groundedAnswerGenerator?: GroundedAnswerGenerator,
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
  const semanticRetrievalRepository = new InMemorySemanticRetrievalRepository(
    spaceRepository,
    documentRepository,
  );
  const authService = createAuthService(authRepository);
  const agentRepository = new InMemoryAgentRepository(spaceRepository);
  const agentService = createAgentService(agentRepository, {
    ready: true,
    providerModel: "test-agent-model",
  });
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
  const semanticRetrievalService = createSemanticRetrievalService(
    semanticRetrievalRepository,
    retrievalEmbeddingGenerator,
  );
  const groundedAnswerService = createGroundedAnswerService(
    semanticRetrievalService,
    semanticRetrievalRepository,
    groundedAnswerGenerator,
  );
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
    agentService,
    spaceService,
    connectionService,
    memberService,
    chatService,
    researchService,
    groundedAnswerService,
    semanticRetrievalService,
    documentService,
    documentUploadMiddleware,
  });

  return {
    app,
    authRepository,
    agentRepository,
    agentService,
    spaceRepository,
    connectionRepository,
    memberRepository,
    chatRepository,
    paperRepository,
    savedPaperRepository,
    summaryRepository,
    documentRepository,
    semanticRetrievalRepository,
    documentStorage,
    authService,
    spaceService,
    chatService,
    researchService,
    groundedAnswerService,
    semanticRetrievalService,
    documentService,
  };
}
