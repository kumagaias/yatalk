import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../server/config.js";
import { ProviderError } from "../../server/errors.js";
import { GeminiVertex, type GeminiModelCall, type GeminiStudioModelCall } from "../../server/services/ai.js";
import type { Cart } from "../../server/inventory.js";
import { syntheticOgg, syntheticWebm } from "../fixtures/audio.js";

const config = loadConfig({ NODE_ENV: "test", GOOGLE_CLOUD_PROJECT: "s-yatalk", GOOGLE_CLOUD_LOCATION: "global" });
const emptyCart: Cart = { items: [], totalMinor: 0, currency: "JPY", cartVersion: 2, catalogRevision: 5 };

test("Gemini cart interpretation requests validated structured output", async () => {
  let captured: Parameters<GeminiModelCall>[0] | undefined;
  const provider = new GeminiVertex(config, async (request) => {
    captured = request;
    return JSON.stringify({ reply: "Added it.", clarification: null, operations: [{ action: "add", productId: "yakisoba", quantity: 2 }] });
  });
  const result = await provider.interpretCart({
    message: "Two yakisoba",
    replyLanguage: "en",
    history: [{ role: "assistant", content: "Welcome." }, { role: "user", content: "Hi" }],
    cart: emptyCart,
    products: [{ id: "yakisoba", name: "Yakisoba", description: "Noodles", available: 6, dietaryNote: "" }],
  });
  assert.equal(result.operations[0]?.quantity, 2);
  assert.equal(captured?.model, "gemini-3.5-flash-lite");
  assert.equal(captured?.config?.responseMimeType, "application/json");
  assert.ok(captured?.config?.responseJsonSchema);
  const finalInput = (captured?.contents as Array<{ parts?: Array<{ text?: string }> }>).at(-1)?.parts?.[0]?.text;
  assert.equal(JSON.parse(finalInput ?? "{}").replyLanguage, "en");
  assert.match(String(captured?.config?.systemInstruction), /requested replyLanguage/u);
});

test("Gemini organizer answer is parsed through a strict schema", async () => {
  const provider = new GeminiVertex(config, async () => JSON.stringify({ answer: "Check the tea first.", restockPriorityIds: ["tea"] }));
  assert.deepEqual(await provider.explainFacts("What should I restock?", { lowStockItems: [{ id: "tea" }] }), {
    answer: "Check the tea first.", restockPriorityIds: ["tea"],
  });
});

test("Gemini transcribes bounded WebM audio without applying it to the cart", async () => {
  let captured: Parameters<GeminiModelCall>[0] | undefined;
  const provider = new GeminiVertex(config, async (request) => {
    captured = request;
    return JSON.stringify({ transcript: "Two yakisoba and one iced tea" });
  });
  const transcript = await provider.transcribeAudio(Buffer.from(syntheticWebm), "audio/webm");
  assert.equal(transcript, "Two yakisoba and one iced tea");
  const contents = captured?.contents as Array<{ parts?: Array<{ inlineData?: { mimeType?: string } }> }>;
  assert.equal(contents[0]?.parts?.[1]?.inlineData?.mimeType, "audio/webm");
});

test("Gemini preserves an empty transcript so the route can ask the visitor to retry", async () => {
  const provider = new GeminiVertex(config, async () => JSON.stringify({ transcript: "" }));
  assert.equal(await provider.transcribeAudio(Buffer.from(syntheticWebm), "audio/webm"), "");
});

test("Gemini accepts bounded Ogg/Opus audio", async () => {
  let captured: Parameters<GeminiModelCall>[0] | undefined;
  const provider = new GeminiVertex(config, async (request) => {
    captured = request;
    return JSON.stringify({ transcript: "A short sample" });
  });
  assert.equal(await provider.transcribeAudio(Buffer.from(syntheticOgg), "audio/ogg"), "A short sample");
  const contents = captured?.contents as Array<{ parts?: Array<{ inlineData?: { mimeType?: string } }> }>;
  assert.equal(contents[0]?.parts?.[1]?.inlineData?.mimeType, "audio/ogg");
});

test("Gemini reads menu photos into editable suggestions without guessing unlisted prices", async () => {
  let captured: Parameters<GeminiModelCall>[0] | undefined;
  const provider = new GeminiVertex(config, async (request) => {
    captured = request;
    return JSON.stringify({ items: [{ name: "Green tea", description: "Cold-brew tea", priceMinor: null, dietaryNote: "" }] });
  });
  const result = await provider.extractMenu(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
  assert.equal(result.items[0]?.priceMinor, null);
  const contents = captured?.contents as Array<{ parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }>;
  assert.equal(contents[0]?.parts?.[1]?.inlineData?.mimeType, "image/jpeg");
  assert.equal(contents[0]?.parts?.[1]?.inlineData?.data, Buffer.from([0xff, 0xd8, 0xff]).toString("base64"));
  assert.ok(captured?.config?.responseJsonSchema);
});

test("Gemini rejects malformed menu extraction output", async () => {
  const provider = new GeminiVertex(config, async () => JSON.stringify({ items: [{ name: "Tea", priceMinor: 300, guessedStock: 20 }] }));
  await assert.rejects(provider.extractMenu(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"),
    (error: unknown) => error instanceof ProviderError && error.provider === "gemini");
});

test("Gemini rejects invalid structured output and unsupported audio", async () => {
  const provider = new GeminiVertex(config, async () => "not json");
  await assert.rejects(provider.explainFacts("Question?", {}), (error: unknown) => error instanceof ProviderError && error.provider === "gemini");
  await assert.rejects(provider.transcribeAudio(Buffer.from("audio"), "audio/webm"), (error: unknown) => error instanceof ProviderError);
  await assert.rejects(provider.transcribeAudio(Buffer.from(""), "audio/ogg"), (error: unknown) => error instanceof ProviderError && error.httpStatus === 400);
});

test("Gemini keeps parallel AG Studio tool calls and their responses in matching turns", async () => {
  let captured: Parameters<GeminiStudioModelCall>[0] | undefined;
  const provider = new GeminiVertex(config, async () => "", async (request) => {
    captured = request;
    return { candidates: [{ content: { parts: [{ functionCall: { id: "new-call", name: "create_chart", args: {} }, thoughtSignature: "opaque-signature" }] } }] } as never;
  });
  await provider.runStudioTurn!({
    input: [
      { kind: "output", type: "function_call", callId: "call-a", name: "create_chart", arguments: "{}", thoughtSignature: "previous-signature" },
      { type: "function_call_output", callId: "call-a", output: "{\"ok\":true}" },
      { kind: "output", type: "function_call", callId: "call-b", name: "create_table", arguments: "{}" },
      { type: "function_call_output", callId: "call-b", output: "{\"ok\":true}" },
    ],
    responseFormat: { type: "text" },
  } as never);
  const contents = captured?.contents as Array<{ role: string; parts: unknown[] }>;
  assert.equal(contents[0]?.role, "model");
  assert.equal(contents[0]?.parts.length, 2);
  assert.equal(contents[1]?.role, "user");
  assert.equal(contents[1]?.parts.length, 2);
  assert.equal((contents[0]?.parts[0] as { thoughtSignature?: string }).thoughtSignature, "previous-signature");
  const output = await provider.runStudioTurn!({ input: [], responseFormat: { type: "text" } } as never);
  assert.equal((output.output[0] as { thoughtSignature?: string }).thoughtSignature, "opaque-signature");
});

test("Gemini retries one transient AG Studio turn failure", async () => {
  let calls = 0;
  const provider = new GeminiVertex(config, async () => "", async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary provider failure");
    return { text: "Here is today's overview." } as never;
  });
  const result = await provider.runStudioTurn!({ input: [], responseFormat: { type: "text" } } as never);
  assert.equal(calls, 2);
  assert.equal(result.output[0]?.type, "message");
});

test("Gemini restores a tool thought signature when AG Studio omits it on the next turn", async () => {
  const requests: Parameters<GeminiStudioModelCall>[0][] = [];
  const provider = new GeminiVertex(config, async () => "", async (request) => {
    requests.push(request);
    return requests.length === 1
      ? { candidates: [{ content: { parts: [{ functionCall: { id: "chart-call", name: "create_chart", args: {} }, thoughtSignature: "server-saved-signature" }] } }] } as never
      : { text: "The chart is ready." } as never;
  });
  await provider.runStudioTurn!({ input: [], responseFormat: { type: "text" } } as never);
  await provider.runStudioTurn!({
    input: [
      { kind: "output", type: "function_call", callId: "chart-call", name: "create_chart", arguments: "{}" },
      { type: "function_call_output", callId: "chart-call", output: "{\"success\":true}", status: "completed" },
    ], responseFormat: { type: "text" },
  } as never);
  const contents = requests[1]?.contents as Array<{ role: string; parts: Array<{ thoughtSignature?: string }> }>;
  assert.equal(contents[0]?.parts[0]?.thoughtSignature, "server-saved-signature");
});

test("Gemini classifies a missing tool thought signature without logging provider text", async () => {
  const error = Object.assign(new Error("Function call is missing a thought_signature."), { status: 400 });
  const provider = new GeminiVertex(config, async () => "", async () => { throw error; });
  await assert.rejects(provider.runStudioTurn!({ input: [], responseFormat: { type: "text" } } as never),
    (cause: unknown) => cause instanceof ProviderError && cause.stage === "ag_studio_thought_signature" && cause.httpStatus === 400);
});
