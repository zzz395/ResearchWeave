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
import { createChatHistoryRouter } from "./modules/chat/routes";
import type { ChatService } from "./modules/chat/service";
import { createConnectionRouter } from "./modules/connections/routes";
import type { ConnectionService } from "./modules/connections/service";
import { createMemberRouter } from "./modules/members/routes";
import type { MemberService } from "./modules/members/service";
import { createSpaceRouter } from "./modules/spaces/routes";
import type { SpaceService } from "./modules/spaces/service";
import { createHealthRouter } from "./routes/health";
import type { DatabaseHealthCheck } from "./types/health";

export interface AppDependencies {
  environment: Environment;
  logger: Logger;
  checkDatabase: DatabaseHealthCheck;
  authService: AuthService;
  spaceService: SpaceService;
  connectionService: ConnectionService;
  memberService: MemberService;
  chatService: ChatService;
}

export function createApp({
  environment,
  logger,
  checkDatabase,
  authService,
  spaceService,
  connectionService,
  memberService,
  chatService,
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
  app.use("/api/v1/connections", requireAuthentication, createConnectionRouter(connectionService));
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
