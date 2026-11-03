import { ApiError, ProviderError } from "./errors.js";

function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) return { errorClass: error.name, errorCode: error.code, errorStatus: error.status };
  if (error instanceof ProviderError) return {
    errorClass: error.name, provider: error.provider, providerStage: error.stage,
    providerHttpStatus: error.httpStatus, providerDefinite: error.definite,
  };
  return error instanceof Error ? { errorClass: error.name } : {};
}

export function logStage(requestId: string, stage: string, outcome: "start" | "success" | "failure", error?: unknown): void {
  const record = {
    timestamp: new Date().toISOString(),
    correlationId: requestId,
    stage,
    outcome,
    ...(error === undefined ? {} : errorFields(error)),
  };
  console.info(JSON.stringify(record));
}
