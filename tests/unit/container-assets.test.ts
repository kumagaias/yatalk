import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const sampleMenu = readFileSync(new URL("../../public/menu-ocr-sample.webp", import.meta.url));

test("the production image includes the public menu OCR sample", () => {
  assert.match(dockerfile, /^COPY public \.\/public$/m);
  assert.equal(sampleMenu.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(sampleMenu.subarray(8, 12).toString("ascii"), "WEBP");
});
