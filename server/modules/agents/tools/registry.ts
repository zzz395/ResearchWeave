import {
  agentToolNameSchema,
  type AgentObservation,
  type AgentToolName,
} from "../../../../shared/contracts/agents";
import type { GroundedAnswerService } from "../../grounded-answer/service";
import type { ResearchService } from "../../research/service";
import type { SemanticRetrievalService } from "../../retrieval/service";
import type { SpaceService } from "../../spaces/service";
import { createAskKnowledgeTool } from "./ask-knowledge";
import {
  agentToolExecutionResultSchema,
  AgentToolError,
  isAgentToolError,
  type AgentEvidenceDraft,
  type AgentTool,
  type AgentToolContext,
} from "./contracts";
import { createSearchArxivTool } from "./search-arxiv";
import { createSearchKnowledgeBaseTool } from "./search-knowledge-base";

export interface AgentToolDescriptor {
  readonly name: AgentToolName;
  readonly description: string;
  readonly argumentsSchema: AgentTool<Record<string, unknown>>["argumentsSchema"];
}

export interface PreparedAgentToolCall {
  readonly toolName: AgentToolName;
  readonly safeArguments: Readonly<Record<string, unknown>>;
  execute(context: AgentToolContext): Promise<{
    observation: AgentObservation;
    evidence: AgentEvidenceDraft[];
  }>;
}

export interface AgentToolRegistry {
  descriptorsFor(allowedToolNames: readonly AgentToolName[]): readonly AgentToolDescriptor[];
  prepareCall(
    allowedToolNames: readonly AgentToolName[],
    rawName: unknown,
    rawArguments: unknown,
  ): PreparedAgentToolCall;
}

type AnyAgentTool = AgentTool<Record<string, unknown>>;

function asAnyTool<TArguments extends Record<string, unknown>>(
  tool: AgentTool<TArguments>,
): AnyAgentTool {
  return tool;
}

export function createAgentToolRegistry(tools: readonly AnyAgentTool[]): AgentToolRegistry {
  const registered = new Map<AgentToolName, AnyAgentTool>();
  for (const tool of tools) {
    if (registered.has(tool.name)) {
      throw new TypeError(`Duplicate Agent tool name: ${tool.name}`);
    }
    registered.set(tool.name, Object.freeze({ ...tool }));
  }

  return Object.freeze({
    descriptorsFor(allowedToolNames: readonly AgentToolName[]) {
      const seen = new Set<AgentToolName>();
      const descriptors: AgentToolDescriptor[] = [];
      for (const name of allowedToolNames) {
        if (seen.has(name)) continue;
        seen.add(name);
        const tool = registered.get(name);
        if (!tool?.isAvailable()) continue;
        descriptors.push(
          Object.freeze({
            name: tool.name,
            description: tool.description,
            argumentsSchema: tool.argumentsSchema,
          }),
        );
      }
      return Object.freeze(descriptors);
    },

    prepareCall(
      allowedToolNames: readonly AgentToolName[],
      rawName: unknown,
      rawArguments: unknown,
    ) {
      const nameResult = agentToolNameSchema.safeParse(rawName);
      const allowed = new Set(allowedToolNames);
      const tool = nameResult.success ? registered.get(nameResult.data) : undefined;
      if (!nameResult.success || !tool || !allowed.has(nameResult.data) || !tool.isAvailable()) {
        throw new AgentToolError("agent_tool_not_allowed");
      }
      const argumentsResult = tool.argumentsSchema.safeParse(rawArguments);
      if (!argumentsResult.success) {
        throw new AgentToolError("agent_tool_invalid_arguments");
      }
      const safeArguments = Object.freeze({ ...argumentsResult.data });
      return Object.freeze({
        toolName: tool.name,
        safeArguments,
        async execute(context: AgentToolContext) {
          let rawResult: unknown;
          try {
            rawResult = await tool.execute(context, argumentsResult.data);
          } catch (error: unknown) {
            if (context.signal.aborted) throw context.signal.reason;
            if (isAgentToolError(error)) throw error;
            throw new AgentToolError("agent_tool_invalid_response");
          }
          if (context.signal.aborted) throw context.signal.reason;
          const toolResult = tool.resultSchema.safeParse(rawResult);
          if (!toolResult.success) {
            throw new AgentToolError("agent_tool_invalid_response");
          }
          const boundedResult = agentToolExecutionResultSchema.safeParse(toolResult.data);
          if (!boundedResult.success) {
            throw new AgentToolError("agent_tool_invalid_response");
          }
          return boundedResult.data;
        },
      });
    },
  });
}

export function createResearchAgentToolRegistry(input: {
  spaceService: Pick<SpaceService, "getSpace">;
  researchService: Pick<ResearchService, "searchPapers">;
  semanticRetrievalService: Pick<SemanticRetrievalService, "retrieve">;
  groundedAnswerService: Pick<GroundedAnswerService, "answerWithSources">;
}): AgentToolRegistry {
  return createAgentToolRegistry([
    asAnyTool(createSearchArxivTool(input.spaceService, input.researchService)),
    asAnyTool(
      createSearchKnowledgeBaseTool(input.spaceService, input.semanticRetrievalService),
    ),
    asAnyTool(createAskKnowledgeTool(input.spaceService, input.groundedAnswerService)),
  ]);
}
