export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function resolveApiPath(path: string, pathname = globalThis.location?.pathname ?? "/"): string {
  if (!path.startsWith("/api/")) return path;
  if (path.startsWith("/api/v1/")) return path;
  const ownerShopPage = /^\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/.exec(pathname);
  if (ownerShopPage && !["api", "dashboard", "shops", "organizer", "owners"].includes(ownerShopPage[1]!)) {
    return `/api/v1/owners/${ownerShopPage[1]}/shops/${ownerShopPage[2]}${path.slice(4)}`;
  }
  const shopPage = /^\/shops\/([a-z0-9-]+)(?:\/|$)/.exec(pathname);
  if (shopPage) return `/api/v1/shops/${shopPage[1]}${path.slice(4)}`;
  const dashboardPage = /^\/dashboard\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/.exec(pathname);
  if (dashboardPage && path.startsWith("/api/organizer/")) {
    return `/api/v1/dashboard/${dashboardPage[1]}/${dashboardPage[2]}${path.slice("/api/organizer".length)}`;
  }
  const legacyDashboardPage = /^\/dashboard\/shops\/([a-z0-9-]+)(?:\/|$)/.exec(pathname);
  if (legacyDashboardPage && path.startsWith("/api/organizer/")) return `/api/v1/dashboard/shops/${legacyDashboardPage[1]}${path.slice("/api/organizer".length)}`;
  return path;
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveApiPath(path), {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("We could not reach the market service. Check your connection and retry.", 0);
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  try {
    payload = contentType.includes("application/json") ? await response.json() : await response.text();
  } catch {
    throw new ApiError("The service returned an unreadable response. Please retry.", response.status);
  }

  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
    const message = typeof nested.message === "string" ? nested.message :
      typeof body.message === "string" ? body.message :
        typeof body.error === "string" ? body.error :
        response.status === 409 ? "This changed while you were working. Refresh the latest information and retry." :
          response.status === 429 ? "There are too many requests right now. Please wait a moment and retry." :
            "That did not go through. Please retry.";
    throw new ApiError(message, response.status, typeof nested.code === "string" ? nested.code : typeof body.code === "string" ? body.code : undefined);
  }
  return payload as T;
}

export const get = <T,>(path: string) => requestJson<T>(path);
export const post = <T,>(path: string, body?: unknown) => requestJson<T>(path, {
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const postAudio = <T,>(path: string, audio: Blob) => requestJson<T>(path, {
  method: "POST",
  body: audio,
  headers: { "Content-Type": audio.type },
});

export const postImage = <T,>(path: string, image: File) => requestJson<T>(path, {
  method: "POST",
  body: image,
  headers: { "Content-Type": image.type },
});
export const putImage = <T,>(path: string, image: File) => requestJson<T>(path, {
  method: "PUT",
  body: image,
  headers: { "Content-Type": image.type },
});
export const patch = <T,>(path: string, body: unknown) => requestJson<T>(path, {
  method: "PATCH",
  body: JSON.stringify(body),
});
export const del = <T,>(path: string) => requestJson<T>(path, { method: "DELETE" });
