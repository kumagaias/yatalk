import type { AppConfig } from "./config.js";
import type { Server } from "node:http";

export function configureRequestTimeouts(server: Server): void {
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
}

export function listenHost(nodeEnv: AppConfig["nodeEnv"]): "0.0.0.0" | "127.0.0.1" {
  return nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1";
}

export function trustedProxyHops(nodeEnv: AppConfig["nodeEnv"]): 1 | false {
  // Cloud Run terminates external traffic at its ingress proxy. The container
  // is not directly reachable, so trust only the adjacent platform proxy.
  // Local/test servers receive direct connections and must ignore forwarded headers.
  return nodeEnv === "production" ? 1 : false;
}
