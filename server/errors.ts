export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message = "Request could not be completed.",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: "paypal" | "gemini",
    public readonly stage: string,
    public readonly definite: boolean,
    public readonly httpStatus?: number,
  ) {
    super(`${provider} ${stage} failed`);
    this.name = "ProviderError";
  }
}

export function errorResponse(error: ApiError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
