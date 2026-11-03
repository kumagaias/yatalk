import assert from "node:assert/strict";
import test from "node:test";
import { getAudioDurationSeconds } from "../../server/audio.js";
import { duplicateClusterTimecodeWebmSample, overlongWebmSample, syntheticOgg, syntheticWebm, unknownClusterWebmSample, webmWithoutDurationAtRelativeOffset } from "../fixtures/audio.js";

test("WebM and Ogg audio containers expose their bounded durations", () => {
  const webmDuration = getAudioDurationSeconds(syntheticWebm, "audio/webm");
  const oggDuration = getAudioDurationSeconds(syntheticOgg, "audio/ogg");
  assert.ok(webmDuration !== null && Math.abs(webmDuration - 2.001) < 0.02);
  assert.ok(oggDuration !== null && Math.abs(oggDuration - 1.980125) < 0.02);
});

test("audio duration parsing rejects malformed or mismatched containers and detects clips over 20 seconds", () => {
  assert.equal(getAudioDurationSeconds(Buffer.from("audio"), "audio/webm"), null);
  assert.equal(getAudioDurationSeconds(syntheticOgg, "audio/webm"), null);
  assert.ok((getAudioDurationSeconds(overlongWebmSample(), "audio/webm") ?? 0) > 20);
  assert.ok((getAudioDurationSeconds(unknownClusterWebmSample(), "audio/webm") ?? 0) > 20);
  assert.ok((getAudioDurationSeconds(webmWithoutDurationAtRelativeOffset(17_800), "audio/webm") ?? 20) < 20);
  assert.ok((getAudioDurationSeconds(webmWithoutDurationAtRelativeOffset(18_010), "audio/webm") ?? 0) > 20);
  assert.equal(getAudioDurationSeconds(duplicateClusterTimecodeWebmSample(), "audio/webm"), null);
  const corruptedOgg = Buffer.from(syntheticOgg);
  corruptedOgg[corruptedOgg.length - 1] ^= 0x01;
  assert.equal(getAudioDurationSeconds(corruptedOgg, "audio/ogg"), null);
});
