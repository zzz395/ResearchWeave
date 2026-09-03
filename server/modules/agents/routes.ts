import { Router } from "express";
import { z } from "zod";

import {
  agentDefinitionListResponseSchema,
  agentDefinitionResponseSchema,
  agentRunCreateResponseSchema,
  agentRunResponseSchema,
  agentRunTraceResponseSchema,
  agentTaskCreateResponseSchema,
  agentTaskListQuerySchema,
  agentTaskListResponseSchema,
  agentTaskResponseSchema,
  cancelAgentRunInputSchema,
  createAgentTaskInputSchema,
  retryAgentTaskInputSchema,
} from "../../../shared/contracts/agents";
import { requireActor } from "../auth/middleware";
import { parseResponse } from "../../middleware/response-validation";
import type { AgentService } from "./service";

const agentParamsSchema = z.object({ agentId: z.string().uuid() }).strict();
const spaceParamsSchema = z.object({ spaceId: z.string().uuid() }).strict();
const taskParamsSchema = z.object({ taskId: z.string().uuid() }).strict();
const runParamsSchema = z.object({ runId: z.string().uuid() }).strict();

export function createAgentDefinitionRouter(service: AgentService) {
  const router = Router();

  router.get("/", async (_request, response) => {
    response.status(200).json(
      parseResponse(agentDefinitionListResponseSchema, { agents: await service.listDefinitions() }),
    );
  });

  router.get("/:agentId", async (request, response) => {
    const { agentId } = agentParamsSchema.parse(request.params);
    response.status(200).json(
      parseResponse(agentDefinitionResponseSchema, { agent: await service.getDefinition(agentId) }),
    );
  });

  return router;
}

export function createSpaceAgentTaskRouter(service: AgentService) {
  const router = Router({ mergeParams: true });

  router.post("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const input = createAgentTaskInputSchema.parse(request.body);
    const result = await service.createTask(spaceId, requireActor(request).id, input);
    response.status(result.created ? 202 : 200).json(parseResponse(agentTaskCreateResponseSchema, result));
  });

  router.get("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const query = agentTaskListQuerySchema.parse(request.query);
    const result = await service.listTasks(spaceId, requireActor(request).id, query);
    response.status(200).json(parseResponse(agentTaskListResponseSchema, result));
  });

  return router;
}

export function createAgentTaskRouter(service: AgentService) {
  const router = Router();

  router.get("/:taskId", async (request, response) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const result = await service.getTask(taskId, requireActor(request).id);
    response.status(200).json(parseResponse(agentTaskResponseSchema, result));
  });

  router.post("/:taskId/runs", async (request, response) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const input = retryAgentTaskInputSchema.parse(request.body);
    const result = await service.retryTask(taskId, requireActor(request).id, input);
    response.status(result.created ? 202 : 200).json(parseResponse(agentRunCreateResponseSchema, result));
  });

  return router;
}

export function createAgentRunRouter(service: AgentService) {
  const router = Router();

  router.get("/:runId", async (request, response) => {
    const { runId } = runParamsSchema.parse(request.params);
    const result = await service.getRun(runId, requireActor(request).id);
    response.status(200).json(parseResponse(agentRunResponseSchema, result));
  });

  router.get("/:runId/steps", async (request, response) => {
    const { runId } = runParamsSchema.parse(request.params);
    const result = await service.getRunTrace(runId, requireActor(request).id);
    response.status(200).json(parseResponse(agentRunTraceResponseSchema, result));
  });

  router.post("/:runId/cancel", async (request, response) => {
    const { runId } = runParamsSchema.parse(request.params);
    cancelAgentRunInputSchema.parse(request.body ?? {});
    const result = await service.cancelRun(runId, requireActor(request).id);
    response.status(200).json(parseResponse(agentRunResponseSchema, result));
  });

  return router;
}
