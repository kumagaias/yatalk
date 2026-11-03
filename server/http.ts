import type { Request } from "express";
import type { ZodType } from "zod";
import { ApiError } from "./errors.js";

export function requireJson(request: Request): void {
  if (!request.is("application/json")) throw new ApiError(415, "json_required", "Send a JSON request body.");
}

export function requireEmptyBody(request: Request): void {
  if (request.body && typeof request.body === "object" && Object.keys(request.body).length > 0) {
    throw new ApiError(400, "invalid_request", "This action does not accept a request body.");
  }
}

export function parseBody<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) throw new ApiError(400, "invalid_request", "Check the request fields and try again.");
  return result.data;
}

export function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
