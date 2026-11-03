import type { Request, RequestHandler } from "express";
import { ApiError } from "./errors.js";

type Entry = { count: number; resetAt: number; touchedAt: number };
type KeyFunction = (request: Request) => string;

export function createRateLimit(limit: number, windowMs: number, keyOf: KeyFunction): RequestHandler {
  const entries = new Map<string, Entry>();
  let calls = 0;
  return (request, _response, next) => {
    const now = Date.now();
    const key = keyOf(request).slice(0, 256);
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs, touchedAt: now };
      entries.set(key, entry);
    }
    entry.count += 1;
    entry.touchedAt = now;
    calls += 1;
    if (calls % 250 === 0) {
      for (const [candidate, value] of entries) if (value.resetAt <= now) entries.delete(candidate);
      if (entries.size > 10_000) {
        const oldest = [...entries.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt).slice(0, entries.size - 8_000);
        for (const [candidate] of oldest) entries.delete(candidate);
      }
    }
    if (entry.count > limit) {
      next(new ApiError(429, "rate_limited", "Too many requests. Please wait and try again."));
      return;
    }
    next();
  };
}

export const ipKey = (request: Request) => request.ip || request.socket.remoteAddress || "unknown";
