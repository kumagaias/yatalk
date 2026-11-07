import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../server/config.js";
import { ProviderError } from "../../server/errors.js";
import { GeminiVertex, type GeminiModelCall } from "../../server/services/ai.js";
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
    history: [{ role: "assistant", content: "Welcome." }, { role: "user", content: "Hi" }],
    cart: emptyCart,
    products: [{ id: "yakisoba", name: "Yakisoba", description: "Noodles", available: 6, dietaryNote: "" }],
  });
  assert.equal(result.operations[0]?.quantity, 2);
  assert.equal(captured?.model, "gemini-3.5-flash-lite");
  assert.equal(captured?.config?.responseMimeType, "application/json");
  assert.ok(captured?.config?.responseJsonSchema);
});

test("Gemini organizer answer is parsed through a strict schema", async () => {
  const provider = new GeminiVertex(config, async () => JSON.stringify({ answer: "Three items are nearly sold out." }));
  assert.equal(await provider.explainFacts("What is low?", { lowStock: ["Tea"] }), "Three items are nearly sold out.");
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
