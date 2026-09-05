import "dotenv/config";

import { createServer } from "node:http";
import path from "node:path";

import { createApp } from "./app";
import { loadEnvironment } from "./config/env";
import { createLogger } from "./config/logger";
import { createDatabase } from "./db/client";
import { OpenAICompatibleAgentDecisionProvider } from "./integrations/agent-decision/openai-compatible-provider";
import { ArxivClient } from "./integrations/arxiv/client";
import { OpenAICompatibleDocumentEmbeddingGenerator } from "./integrations/document-embedding/openai-compatible-document-embedding-generator";
import { createDocumentTextExtractor } from "./integrations/document-extraction/document-text-extractor";
import { LocalFilesystemDocumentStorage } from "./integrations/document-storage/local-filesystem-storage";
import { createDocumentUploadMiddleware } from "./integrations/document-upload/middleware";
import { OpenAICompatibleGroundedAnswerGenerator } from "./integrations/grounded-answer/openai-compatible-generator";
import { OpenAICompatibleResearchSummaryGenerator } from "./integrations/research-summary/openai-compatible-generator";
import { createDrizzleAgentRepository } from "./modules/agents/repository";
import { createAgentRunExecutor } from "./modules/agents/run-executor";
import { createAgentRuntime, type AgentRuntime } from "./modules/agents/runtime";
import { createAgentService } from "./modules/agents/service";
import { createResearchAgentToolRegistry } from "./modules/agents/tools/registry";
import { createAgentWorker } from "./modules/agents/worker";
import { createDrizzleChatRepository } from "./modules/chat/repository";
import { createChatService } from "./modules/chat/service";
import { createDrizzleConnectionRepository } from "./modules/connections/repository";
import { createConnectionService } from "./modules/connections/service";
import { createDrizzleDocumentRepository } from "./modules/documents/repository";
import { createDocumentChunker } from "./modules/documents/document-chunker";
import {
  UnconfiguredDocumentEmbeddingGenerator,
  type DocumentEmbeddingGenerator,
} from "./modules/documents/document-embedding-generator";
import { DocumentIndexingWorker } from "./modules/documents/document-indexing-worker";
import { createDocumentService } from "./modules/documents/service";
import { createDrizzleAuthRepository } from "./modules/auth/repository";
import { createAuthService } from "./modules/auth/service";
import { createDrizzleMemberRepository } from "./modules/members/repository";
import { createMemberService } from "./modules/members/service";
import { createGroundedAnswerService } from "./modules/grounded-answer/service";
import { createDrizzlePaperRepository } from "./modules/research/paper-repository";
import { createDrizzleSavedPaperRepository } from "./modules/research/saved-paper-repository";
import { createDrizzlePaperSummaryRepository } from "./modules/research/summary-repository";
import { createResearchService } from "./modules/research/service";
import { createDrizzleSemanticRetrievalRepository } from "./modules/retrieval/repository";
import { createSemanticRetrievalService } from "./modules/retrieval/service";
import { createDrizzleSpaceRepository } from "./modules/spaces/repository";
import { createSpaceService } from "./modules/spaces/service";
import { attachRealtimeGateway } from "./realtime/gateway";
import { RealtimeHub } from "./realtime/hub";
import {
  ApplicationLifecycleStopError,
  attachApplicationWorkerStartupLifecycle,
} from "./startup-lifecycle";

const environment = loadEnvironment();
const logger = createLogger(environment);
const database = createDatabase(environment.DATABASE_URL);
const realtimeHub = new RealtimeHub();
const authService = createAuthService(createDrizzleAuthRepository(database), {
  sessionEnded: (tokenHash) => realtimeHub.closeSession(tokenHash),
});
const spaceRepository = createDrizzleSpaceRepository(database);
const connectionRepository = createDrizzleConnectionRepository(database);
const spaceService = createSpaceService(spaceRepository, {
  spaceDeleted: (spaceId) => realtimeHub.revokeSpace(spaceId),
});
const connectionService = createConnectionService(connectionRepository);
const documentStorage = new LocalFilesystemDocumentStorage(
  path.resolve(process.cwd(), environment.DOCUMENT_STORAGE_DIR),
);
const documentRepository = createDrizzleDocumentRepository(database);
const documentService = createDocumentService(
  documentRepository,
  documentStorage,
  logger,
);
const documentUploadMiddleware = createDocumentUploadMiddleware(documentStorage, logger);
const memberService = createMemberService(
  createDrizzleMemberRepository(database),
  spaceRepository,
  connectionRepository,
  { memberRemoved: (spaceId, userId) => realtimeHub.revokeMember(spaceId, userId) },
);
const chatService = createChatService(createDrizzleChatRepository(database), spaceRepository);
const summaryGenerator =
  environment.LLM_BASE_URL && environment.LLM_API_KEY && environment.LLM_MODEL
    ? new OpenAICompatibleResearchSummaryGenerator({
        baseUrl: environment.LLM_BASE_URL,
        apiKey: environment.LLM_API_KEY,
        model: environment.LLM_MODEL,
      })
    : undefined;
const researchService = createResearchService(
  createDrizzlePaperRepository(database),
  createDrizzleSavedPaperRepository(database),
  new ArxivClient(),
  createDrizzlePaperSummaryRepository(database),
  summaryGenerator,
);
const documentEmbeddingGenerator: DocumentEmbeddingGenerator =
  environment.LLM_BASE_URL && environment.LLM_API_KEY
    ? new OpenAICompatibleDocumentEmbeddingGenerator({
        baseUrl: environment.LLM_BASE_URL,
        apiKey: environment.LLM_API_KEY,
      })
    : new UnconfiguredDocumentEmbeddingGenerator();
const semanticRetrievalRepository = createDrizzleSemanticRetrievalRepository(database);
const semanticRetrievalService = createSemanticRetrievalService(
  semanticRetrievalRepository,
  documentEmbeddingGenerator,
);
const groundedAnswerGenerator =
  environment.LLM_BASE_URL && environment.LLM_API_KEY && environment.LLM_MODEL
    ? new OpenAICompatibleGroundedAnswerGenerator({
        baseUrl: environment.LLM_BASE_URL,
        apiKey: environment.LLM_API_KEY,
        model: environment.LLM_MODEL,
      })
    : undefined;
const groundedAnswerService = createGroundedAnswerService(
  semanticRetrievalService,
  semanticRetrievalRepository,
  groundedAnswerGenerator,
);
const agentRepository = createDrizzleAgentRepository(database);
let agentRuntime: AgentRuntime;
if (environment.LLM_BASE_URL && environment.LLM_API_KEY && environment.LLM_MODEL) {
  try {
    const decisionProvider = new OpenAICompatibleAgentDecisionProvider({
      baseUrl: environment.LLM_BASE_URL,
      apiKey: environment.LLM_API_KEY,
      model: environment.LLM_MODEL,
    });
    const toolRegistry = createResearchAgentToolRegistry({
      spaceService,
      researchService,
      semanticRetrievalService,
      groundedAnswerService,
    });
    const executor = createAgentRunExecutor({
      repository: agentRepository,
      decisionProvider,
      toolRegistry,
    });
    const worker = createAgentWorker({
      repository: agentRepository,
      executor,
      logger,
    });
    agentRuntime = createAgentRuntime({
      configured: true,
      providerModel: decisionProvider.model,
      worker,
    });
  } catch (error: unknown) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "configured Agent runtime composition failed",
    );
    process.exitCode = 1;
    await database.close();
    throw new Error("Configured Agent runtime composition failed.", { cause: error });
  }
} else {
  agentRuntime = createAgentRuntime({ configured: false });
}
const agentService = createAgentService(agentRepository, agentRuntime);
const documentIndexingWorker = new DocumentIndexingWorker({
  repository: documentRepository,
  storage: documentStorage,
  extractor: createDocumentTextExtractor(),
  chunker: createDocumentChunker(),
  embeddingGenerator: documentEmbeddingGenerator,
  logger,
});
const app = createApp({
  environment,
  logger,
  checkDatabase: () => database.checkHealth(),
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
const server = createServer(app);
const realtimeGateway = attachRealtimeGateway({
  server,
  environment,
  logger,
  authService,
  spaceService,
  chatService,
  hub: realtimeHub,
});

const applicationWorkerLifecycle = attachApplicationWorkerStartupLifecycle(server, {
  components: [
    {
      name: "document indexing worker",
      start: () => documentIndexingWorker.start(),
      stop: () => documentIndexingWorker.stop(),
    },
    {
      name: "Agent runtime",
      stopWhileStarting: true,
      start: () => agentRuntime.start(),
      stop: () => agentRuntime.stop(),
    },
  ],
  onServerError: (error) => {
    logger.fatal({ errorType: error.name }, "HTTP server failed");
    process.exitCode = 1;
    void shutdown("http_server_error");
  },
  onComponentStartError: (componentName, error) => {
    logger.fatal(
      {
        component: componentName,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "application worker component failed to start",
    );
    process.exitCode = 1;
    void shutdown("worker_startup_failure");
  },
});

server.listen(environment.PORT, "0.0.0.0", () => {
  logger.info({ port: environment.PORT }, "ResearchWeave API listening");
});

type ShutdownReason = NodeJS.Signals | "http_server_error" | "worker_startup_failure";

let shutdownPromise: Promise<void> | null = null;

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function lifecycleStopFailures(error: unknown) {
  if (!(error instanceof AggregateError)) return undefined;
  return error.errors.map((failure: unknown) =>
    failure instanceof ApplicationLifecycleStopError
      ? {
          component: failure.componentName,
          errorType: errorType(failure.cause),
        }
      : { component: "unknown", errorType: errorType(failure) },
  );
}

function shutdown(reason: ShutdownReason): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  logger.info({ reason }, "graceful shutdown started");

  shutdownPromise = (async () => {
    let failed = false;
    const closeResource = async (resource: string, close: () => Promise<void>) => {
      try {
        await close();
      } catch (error: unknown) {
        failed = true;
        process.exitCode = 1;
        logger.error(
          {
            resource,
            errorType: errorType(error),
            lifecycleFailures: lifecycleStopFailures(error),
          },
          "graceful shutdown resource failed",
        );
      }
    };

    await closeResource("application workers", () =>
      applicationWorkerLifecycle.shutdownComponents(),
    );
    await closeResource("realtime gateway", () => realtimeGateway.close());
    await closeResource(
      "HTTP server",
      () =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    await closeResource("database", () => database.close());

    logger.info({ failed }, "graceful shutdown completed");
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
