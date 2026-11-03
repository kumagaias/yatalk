import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { configureRequestTimeouts, listenHost, trustedProxyHops } from "../../server/network.js";

test("production binds to all container interfaces and local modes stay loopback-only", () => {
  assert.equal(listenHost("production"), "0.0.0.0");
  assert.equal(listenHost("development"), "127.0.0.1");
  assert.equal(listenHost("test"), "127.0.0.1");
});

function requestIp(nodeEnv: "production" | "test", forwardedFor: string): string {
  const app = express();
  app.set("trust proxy", trustedProxyHops(nodeEnv));
  const request = Object.assign(Object.create(app.request), {
    app,
    headers: { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress: "10.0.0.1" },
  }) as express.Request;
  return request.ip ?? "";
}

test("production trusts only the nearest proxy hop and local tests ignore forwarded IPs", () => {
  assert.equal(requestIp("production", "198.51.100.77, 203.0.113.9"), "203.0.113.9");
  assert.equal(requestIp("test", "198.51.100.77"), "10.0.0.1");
});

test("request headers and body have bounded receive times", () => {
  const server = createServer();
  configureRequestTimeouts(server);
  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.requestTimeout, 60_000);
});
