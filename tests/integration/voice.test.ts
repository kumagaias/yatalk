import assert from "node:assert/strict";
import test from "node:test";
import type { AiProvider } from "../../server/services/ai.js";
import { overlongWebmSample, syntheticWebm } from "../fixtures/audio.js";
import { FakePayPal, json, origin, postHeaders, visitorSession, withServer } from "./support.js";

test("voice transcription validates origin, session, media format, and recording length", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const denied = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(denied.response.status, 403);
    const deniedOversized = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "audio/webm" }, body: new Uint8Array(4 * 1024 * 1024 + 1) });
    assert.equal(deniedOversized.response.status, 403);

    const noSession = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { origin, "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(noSession.response.status, 401);
    const visitor = await visitorSession(url);
    const unsupported = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/wav" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(unsupported.response.status, 415);
    const malformed = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(malformed.response.status, 400);

    const transcribed = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm;codecs=opus" }, body: new Uint8Array(syntheticWebm) });
    assert.equal(transcribed.response.status, 200);
    assert.equal(transcribed.body.transcript, "Two yakisoba and one iced tea");
    const tooLong = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array(overlongWebmSample()) });
    assert.equal(tooLong.response.status, 413);
    assert.equal(tooLong.body.error.code, "audio_too_long");
    const oversized = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array(4 * 1024 * 1024 + 1) });
    assert.equal(oversized.response.status, 413);

    const oversizedWithoutContentType = await fetch(`${url}/api/voice/transcribe`, { method: "POST",
      headers: { cookie: visitor.cookie, origin }, body: new Uint8Array(256 * 1024 + 1) });
    assert.equal(oversizedWithoutContentType.status, 413);
  });
});

test("nested owner storefront voice requests reach the audio validator above the generic body limit", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerSlug = `voice-owner-${suffix}`;
    const shopSlug = `voice-shop-${suffix}`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Voice owner", ownerSlug, email: `${suffix}@example.test`,
        password: "a-test-password-123", defaultCurrency: "JPY" }),
    });
    assert.equal(registration.response.status, 201);
    const ownerCookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(ownerCookie);
    const created = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(ownerCookie!), body: JSON.stringify({ name: "Voice Shop", slug: shopSlug }),
    });
    assert.equal(created.response.status, 201);

    const storefront = `/api/v1/owners/${ownerSlug}/shops/${shopSlug}`;
    const visitor = await json(`${url}${storefront}/cart`);
    const visitorCookie = visitor.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(visitorCookie);
    const largeMalformedAudio = await json(`${url}${storefront}/voice/transcribe`, {
      method: "POST", headers: { cookie: visitorCookie!, origin, "content-type": "audio/webm" },
      body: new Uint8Array(40 * 1024),
    });
    assert.equal(largeMalformedAudio.response.status, 400);
    assert.equal(largeMalformedAudio.body.error.code, "invalid_audio");
  });
});

test("voice transcription has an IP-wide limit across visitor sessions", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const visitors = await Promise.all(Array.from({ length: 3 }, () => visitorSession(url)));
    for (const visitor of visitors) {
      for (let index = 0; index < 4; index += 1) {
        const result = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array(syntheticWebm) });
        assert.equal(result.response.status, 200);
      }
    }
    const limited = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitors[0]!.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array(syntheticWebm) });
    assert.equal(limited.response.status, 429);
  });
});

test("voice route returns a retry message when a valid clip contains no clear speech", async () => {
  const noSpeechAi: AiProvider = {
    async interpretCart() { return { reply: "", clarification: null, operations: [] }; },
    async explainFacts() { return { answer: "", restockPriorityIds: [] }; },
    async assistMenu() { return { reply: "I can help draft menu items.", suggestions: [] }; },
    async transcribeAudio() { return ""; },
    async extractMenu() { return { items: [] }; },
  };
  await withServer(new FakePayPal(), async (url) => {
    const visitor = await visitorSession(url);
    const result = await json(`${url}/api/voice/transcribe`, { method: "POST", headers: { cookie: visitor.cookie, origin, "content-type": "audio/webm" }, body: new Uint8Array(syntheticWebm) });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.error.code, "no_speech");
  }, noSpeechAi);
});
