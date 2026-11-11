import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { engines?: { node?: string } };
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const toolVersions = readFileSync(new URL("../../.tool-versions", import.meta.url), "utf8");

test("development and container runtime stay on Node 24.22", () => {
  assert.equal(packageJson.engines?.node, "24.22.x");
  assert.match(toolVersions, /^node 24\.22\.3$/m);
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:24\.22\.3-alpine3\.24@sha256:[a-f0-9]{64}$/m);
});
