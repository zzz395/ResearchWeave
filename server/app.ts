import path from "node:path";

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";

import type { Environment } from "./config/env";
import { createErrorHandler, createNotFoundHandler } from "./middleware/error-handler";
import { createOriginGuard } from "./middleware/origin-guard";
import { requestIdMiddleware } from "./middleware/request-id";
import { createRequestLogger } from "./middleware/request-logger";
import { createSessionMiddleware, requireAuthentication } from "./modules/auth/middleware";
import { createAuthRouter } from "./modules/auth/routes";
import type { AuthService } from "./modules/auth/service";
import {
  createAgentDefinitionRouter,
  createAgentRunRouter,
  createAgentTaskRouter,
  createSpaceAgentTaskRouter,
} from "./modules/agents/routes";
import type { AgentService } from "./modules/agents/service";
import { createChatHistoryRouter } from "./modules/chat/routes";
import type { ChatService } from "./modules/chat/service";
import { createConnectionRouter } from "./modules/connections/routes";
import type { ConnectionService } from "./modules/connections/service";
import { createDocumentRouter } from "./modules/documents/routes";
import type { DocumentService } from "./modules/documents/service";
import { createGroundedAnswerRouter } from "./modules/grounded-answer/routes";
import type { GroundedAnswerService } from "./modules/grounded-answer/service";
import { createMemberRouter } from "./modules/members/routes";
import type { MemberService } from "./modules/members/service";
import { createResearchRouter, createSavedPaperRouter } from "./modules/research/routes";
import type { ResearchService } from "./modules/research/service";
import { createSemanticRetrievalRouter } from "./modules/retrieval/routes";
import type { SemanticRetrievalService } from "./modules/retrieval/service";
import { createSpaceRouter } from "./modules/spaces/routes";
import type { SpaceService } from "./modules/spaces/service";
import { createHealthRouter } from "./routes/health";
import type { DatabaseHealthCheck } from "./types/health";

export interface AppDependencies {
  environment: Environment;
  logger: Logger;
  checkDatabase: DatabaseHealthCheck;
  authService: AuthService;
  agentService: AgentService;
  spaceService: SpaceService;
  connectionService: ConnectionService;
  memberService: MemberService;
  chatService: ChatService;
  researchService: ResearchService;
  groundedAnswerService: GroundedAnswerService;
  semanticRetrievalService: SemanticRetrievalService;
  documentService: DocumentService;
  documentUploadMiddleware: import("express").RequestHandler;
}

export function createApp({
  environment,
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
}: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: environment.CLIENT_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(createRequestLogger(logger));

  app.use("/api/v1", createHealthRouter({ checkDatabase, logger }));
  app.use("/api/v1", createOriginGuard(environment));
  app.use(createSessionMiddleware(authService, environment));
  app.use("/api/v1/auth", createAuthRouter({ authService, environment }));
  app.use("/api/v1/agents", requireAuthentication, createAgentDefinitionRouter(agentService));
  app.use("/api/v1/agent-tasks", requireAuthentication, createAgentTaskRouter(agentService));
  app.use("/api/v1/agent-runs", requireAuthentication, createAgentRunRouter(agentService));
  app.use("/api/v1/connections", requireAuthentication, createConnectionRouter(connectionService));
  app.use(
    "/api/v1/spaces/:spaceId/agent-tasks",
    requireAuthentication,
    createSpaceAgentTaskRouter(agentService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/members",
    requireAuthentication,
    createMemberRouter(memberService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/messages",
    requireAuthentication,
    createChatHistoryRouter(chatService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/saved-papers",
    requireAuthentication,
    createSavedPaperRouter(researchService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/knowledge/ask",
    requireAuthentication,
    createGroundedAnswerRouter(groundedAnswerService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/knowledge/retrieve",
    requireAuthentication,
    createSemanticRetrievalRouter(semanticRetrievalService),
  );
  app.use(
    "/api/v1/spaces/:spaceId/documents",
    requireAuthentication,
    createDocumentRouter(documentService, documentUploadMiddleware),
  );
  app.use("/api/v1/research", requireAuthentication, createResearchRouter(researchService));
  app.use("/api/v1/spaces", requireAuthentication, createSpaceRouter(spaceService));

  if (environment.NODE_ENV === "production") {
    const clientDirectory = path.resolve(process.cwd(), "dist/client");
    const clientEntry = path.join(clientDirectory, "index.html");

    app.use(express.static(clientDirectory, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.sendFile(clientEntry, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
