import assert from "node:assert/strict";
import test from "node:test";
import { amountFromMinor, formatMinor, minorToProviderAmount, parseAmountToMinor } from "../../shared/currency.js";

test("currency amounts keep zero- and two-decimal currencies in integer minor units", () => {
  assert.equal(parseAmountToMinor("125", "JPY"), 125);
  assert.equal(parseAmountToMinor("12.34", "USD"), 1234);
  assert.equal(parseAmountToMinor("12.3", "EUR"), 1230);
  assert.equal(parseAmountToMinor("12.34", "JPY"), null);
  assert.equal(parseAmountToMinor("1.234", "USD"), null);
  assert.equal(parseAmountToMinor("5", "XYZ"), null);
  assert.equal(amountFromMinor(1234, "USD"), "12.34");
  assert.equal(amountFromMinor(125, "JPY"), "125");
  assert.equal(minorToProviderAmount(1234, "GBP"), "12.34");
  assert.match(formatMinor(1234, "USD"), /12\.34/);
});
