import assert from "node:assert/strict";
import test from "node:test";
import { restoreStudioThoughtSignatures } from "../../src/lib/agStudioGeminiAdapter.js";

test("AG Studio adapter restores a saved Gemini thought signature by call ID", () => {
  const input = [{ kind: "output", type: "function_call", callId: "call-1", name: "create_chart", arguments: "{}" }];
  const restored = restoreStudioThoughtSignatures(input as never, new Map([["call-1", "opaque-signature"]]));
  assert.equal((restored[0] as { thoughtSignature?: string }).thoughtSignature, "opaque-signature");
});

test("AG Studio adapter leaves an existing thought signature untouched", () => {
  const input = [{ kind: "output", type: "function_call", callId: "call-1", name: "create_chart", arguments: "{}", thoughtSignature: "original" }];
  const restored = restoreStudioThoughtSignatures(input as never, new Map([["call-1", "replacement"]]));
  assert.equal((restored[0] as { thoughtSignature?: string }).thoughtSignature, "original");
});
