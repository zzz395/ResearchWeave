import "dotenv/config";

import { createServer } from "node:http";

import { createApp } from "./app";
import { loadEnvironment } from "./config/env";
import { createLogger } from "./config/logger";
import { createDatabase } from "./db/client";
import { ArxivClient } from "./integrations/arxiv/client";
import { OpenAICompatibleResearchSummaryGenerator } from "./integrations/research-summary/openai-compatible-generator";
import { createDrizzleChatRepository } from "./modules/chat/repository";
import { createChatService } from "./modules/chat/service";
import { createDrizzleConnectionRepository } from "./modules/connections/repository";
import { createConnectionService } from "./modules/connections/service";
import { createDrizzleAuthRepository } from "./modules/auth/repository";
import { createAuthService } from "./modules/auth/service";
import { createDrizzleMemberRepository } from "./modules/members/repository";
import { createMemberService } from "./modules/members/service";
import { createDrizzlePaperRepository } from "./modules/research/paper-repository";
import { createDrizzleSavedPaperRepository } from "./modules/research/saved-paper-repository";
import { createDrizzlePaperSummaryRepository } from "./modules/research/summary-repository";
import { createResearchService } from "./modules/research/service";
import { createDrizzleSpaceRepository } from "./modules/spaces/repository";
import { createSpaceService } from "./modules/spaces/service";
import { attachRealtimeGateway } from "./realtime/gateway";
import { RealtimeHub } from "./realtime/hub";

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
const app = createApp({
  environment,
  logger,
  checkDatabase: () => database.checkHealth(),
  authService,
  spaceService,
  connectionService,
  memberService,
  chatService,
  researchService,
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

server.on("error", (error) => {
  logger.fatal({ errorType: error.name }, "HTTP server failed");
  process.exitCode = 1;
});

server.listen(environment.PORT, "0.0.0.0", () => {
  logger.info({ port: environment.PORT }, "ResearchWeave API listening");
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "graceful shutdown started");

  await realtimeGateway.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await database.close();
  logger.info("graceful shutdown completed");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
