import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync(new URL("../../src/main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../src/styles/global.css", import.meta.url), "utf8");

test("responsive styles load after base styles so mobile overrides win", () => {
  const baseStyles = entry.indexOf('import "./styles/global.css";');
  const responsiveStyles = entry.indexOf('import "./styles/responsive.css";');

  assert.notEqual(baseStyles, -1);
  assert.ok(responsiveStyles > baseStyles);
});

test("header and footer links meet the 44px touch-target height", () => {
  assert.match(styles, /\.brand\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.market-footer a\s*\{[^}]*min-height:\s*44px/);
});
