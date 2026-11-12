import assert from "node:assert/strict";
import test from "node:test";
import { createPrepRecommendation } from "../../src/lib/prepRecommendation.js";

test("prep recommendation reports items that cannot cover recent demand", () => {
  assert.equal(createPrepRecommendation([
    { itemName: "Iced Tea", unitsSoldLast7Days: 12, availableUnits: 4 },
    { itemName: "Hot Dog", unitsSoldLast7Days: 3, availableUnits: 5 },
  ]), "Restock before the next rush: Iced Tea (+8).");
});

test("prep recommendation does not ask Gemini when there are no recent sales", () => {
  assert.equal(createPrepRecommendation([
    { itemName: "Iced Tea", unitsSoldLast7Days: 0, availableUnits: 20 },
  ]), "No menu-item sales were recorded in the last 7 days, so no additional prep is recommended today.");
});
