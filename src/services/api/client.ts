import { type ZodType } from "zod";

import { errorEnvelopeSchema, type ErrorEnvelope } from "../../../shared/contracts/error";
import {
  actorOwnership,
  type ActorOwnershipSnapshot,
} from "../../features/auth/actor-ownership";

interface ApiRequestOptions extends RequestInit {
  acceptedStatuses?: readonly number[];
  authMode?: "protected" | "session" | "credential" | "session-mutation";
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number, requestId?: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export const AUTH_EXPIRED_EVENT = "researchweave:auth-expired";

export interface AuthExpiredEventDetail {
  actorId: string;
  generation: number;
}

interface LinkedAbortSignal {
  dispose: () => void;
  signal: AbortSignal | undefined;
}

function linkAbortSignals(...signals: Array<AbortSignal | null | undefined>): LinkedAbortSignal {
  const sources = [...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined && signal !== null))];
  if (sources.length === 0) return { dispose: () => undefined, signal: undefined };
  if (sources.length === 1) return { dispose: () => undefined, signal: sources[0] };

  const controller = new AbortController();
  const removers: Array<() => void> = [];
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const abort = () => controller.abort(source.reason);
    source.addEventListener("abort", abort, { once: true });
    removers.push(() => source.removeEventListener("abort", abort));
  }
  return {
    dispose: () => {
      for (const remove of removers) remove();
    },
    signal: controller.signal,
  };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function canExpireProtectedSession(
  ownership: ActorOwnershipSnapshot | null,
  requestSignal: AbortSignal | undefined,
): ownership is ActorOwnershipSnapshot & { actorId: string } {
  return ownership !== null
    && ownership.actorId !== null
    && !requestSignal?.aborted
    && actorOwnership.owns(ownership);
}

async function readJson(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (signal?.aborted) throw abortReason(signal);
    if (isAbortError(error)) throw error;
    throw new ApiClientError(
      "The API returned an unreadable response.",
      "invalid_api_response",
      response.status,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    acceptedStatuses = [200],
    authMode = "protected",
    headers,
    ...requestOptions
  } = options;
  const ownership = authMode === "protected" ? actorOwnership.current() : null;
  const linkedSignal = linkAbortSignals(
    requestOptions.signal,
    ownership?.signal,
  );
  const hasFormDataBody =
    typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        ...requestOptions,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(requestOptions.body === undefined || hasFormDataBody
            ? {}
            : { "Content-Type": "application/json" }),
          ...headers,
        },
        signal: linkedSignal.signal,
      });
    } catch {
      if (linkedSignal.signal?.aborted) throw abortReason(linkedSignal.signal);
      throw new ApiClientError(
        "The ResearchWeave API could not be reached.",
        "network_error",
      );
    }

    throwIfAborted(linkedSignal.signal);
    const body = response.status === 204
      ? undefined
      : await readJson(response, linkedSignal.signal);
    throwIfAborted(linkedSignal.signal);

    if (!acceptedStatuses.includes(response.status)) {
      if (
        response.status === 401
        && authMode === "protected"
        && typeof window !== "undefined"
        && canExpireProtectedSession(ownership, linkedSignal.signal)
      ) {
        const detail: AuthExpiredEventDetail = {
          actorId: ownership.actorId,
          generation: ownership.generation,
        };
        window.dispatchEvent(new CustomEvent<AuthExpiredEventDetail>(AUTH_EXPIRED_EVENT, { detail }));
      }
      const parsedError = errorEnvelopeSchema.safeParse(body);
      if (parsedError.success) {
        const envelope: ErrorEnvelope = parsedError.data;
        throw new ApiClientError(
          envelope.error.message,
          envelope.error.code,
          response.status,
          envelope.error.requestId,
        );
      }

      throw new ApiClientError(
        "The API request failed.",
        "api_request_failed",
        response.status,
        response.headers.get("x-request-id") ?? undefined,
      );
    }

    const parsedBody = schema.safeParse(body);
    if (!parsedBody.success) {
      throw new ApiClientError(
        "The API response did not match its contract.",
        "api_contract_mismatch",
        response.status,
        response.headers.get("x-request-id") ?? undefined,
      );
    }

    return parsedBody.data;
  } finally {
    linkedSignal.dispose();
  }
}
