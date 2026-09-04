import type { AgentErrorCode } from "../../../../shared/contracts/agents";
import { AppError } from "../../../middleware/app-error";
import type { SpaceService } from "../../spaces/service";
import {
  AgentToolError,
  isAgentToolError,
  type AgentToolContext,
} from "./contracts";

export function truncateUnicode(value: string, maximumCodePoints: number): string {
  if (!Number.isInteger(maximumCodePoints) || maximumCodePoints < 1) {
    throw new TypeError("The Unicode truncation limit must be a positive integer.");
  }
  const trimmed = value.trim();
  const codePoints = Array.from(trimmed);
  if (codePoints.length <= maximumCodePoints && trimmed.length <= maximumCodePoints) {
    return trimmed;
  }
  if (maximumCodePoints === 1) return "…";
  const selected: string[] = [];
  let utf16Units = 0;
  for (const codePoint of codePoints) {
    if (
      selected.length >= maximumCodePoints - 1 ||
      utf16Units + codePoint.length > maximumCodePoints - 1
    ) {
      break;
    }
    selected.push(codePoint);
    utf16Units += codePoint.length;
  }
  return `${selected.join("")}…`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

export async function executeAuthorizedTool<TResult, TNormalized>(input: {
  context: AgentToolContext;
  spaceService: Pick<SpaceService, "getSpace">;
  allowedErrorCodes: ReadonlySet<AgentErrorCode>;
  delegate: () => Promise<TResult>;
  normalize: (result: TResult) => TNormalized;
}): Promise<TNormalized> {
  const { context } = input;
  try {
    throwIfAborted(context.signal);
    await input.spaceService.getSpace(context.spaceId, context.actorUserId);
    throwIfAborted(context.signal);
    const result = await input.delegate();
    throwIfAborted(context.signal);
    return input.normalize(result);
  } catch (error: unknown) {
    if (context.signal.aborted) throw context.signal.reason;
    if (isAgentToolError(error)) throw error;
    if (error instanceof AppError) {
      if (error.code === "space_not_found") {
        throw new AgentToolError("agent_space_access_revoked");
      }
      if (input.allowedErrorCodes.has(error.code as AgentErrorCode)) {
        throw new AgentToolError(error.code as AgentErrorCode);
      }
    }
    throw new AgentToolError("agent_tool_invalid_response");
  }
}
