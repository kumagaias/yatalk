import assert from "node:assert/strict";
import test from "node:test";
import { detectMenuImageMimeType } from "../../server/menu-image.js";

test("menu image validator accepts supported photo signatures", () => {
  assert.equal(detectMenuImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectMenuImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectMenuImageMimeType(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(detectMenuImageMimeType(Buffer.from("0000ftypheic")), "image/heic");
  assert.equal(detectMenuImageMimeType(Buffer.from("0000ftypmif1")), "image/heif");
});

test("menu image validator rejects mismatched and unsupported content", () => {
  assert.equal(detectMenuImageMimeType(Buffer.from("<svg></svg>")), null);
  assert.equal(detectMenuImageMimeType(Buffer.from("RIFF0000WEBPxxxx")), null);
  assert.equal(detectMenuImageMimeType(Buffer.from([0xff, 0xd8])), null);
});
