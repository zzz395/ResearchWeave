import { type ZodType } from "zod";

import { errorEnvelopeSchema, type ErrorEnvelope } from "../../../shared/contracts/error";

interface ApiRequestOptions extends RequestInit {
  acceptedStatuses?: readonly number[];
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
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
  const { acceptedStatuses = [200], headers, ...requestOptions } = options;
  let response: Response;

  try {
    response = await fetch(path, {
      ...requestOptions,
      headers: {
        Accept: "application/json",
        ...headers,
      },
    });
  } catch {
    throw new ApiClientError(
      "The ResearchWeave API could not be reached.",
      "network_error",
    );
  }

  const body = await readJson(response);

  if (!acceptedStatuses.includes(response.status)) {
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
}
