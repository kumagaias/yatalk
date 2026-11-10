import assert from "node:assert/strict";
import test from "node:test";
import { buildRestockPlan, isInventoryQuestion } from "../../server/restock-plan.js";

test("inventory questions include English and Japanese sales and restock wording", () => {
  for (const question of [
    "What should I restock first?",
    "Which item sold most?",
    "What is the best-selling item?",
    "売れ筋はどれ？",
    "何を仕入れるべき？",
    "在庫を補充したい",
  ]) assert.equal(isInventoryQuestion(question), true, question);

  assert.equal(isInventoryQuestion("Suggest a description for my tea stall"), false);
});

test("restock plan uses seven-day sales, two-day cover, and a five-unit minimum", () => {
  const plan = buildRestockPlan([
    { id: "empty", name: "Empty shelf", available: 0 },
    { id: "fast", name: "Fast seller", available: 8 },
    { id: "steady", name: "Steady seller", available: 4 },
    { id: "quiet", name: "Quiet item", available: 2 },
  ], [
    { id: "empty", units_sold: 7 },
    { id: "fast", units_sold: 35 },
    { id: "steady", units_sold: 7 },
  ]);

  assert.deepEqual(plan.map(({ id, targetStock, suggestedQuantity }) => ({ id, targetStock, suggestedQuantity })), [
    { id: "empty", targetStock: 5, suggestedQuantity: 5 },
    { id: "fast", targetStock: 10, suggestedQuantity: 2 },
    { id: "steady", targetStock: 5, suggestedQuantity: 1 },
  ]);
  assert.equal(plan.some(({ id }) => id === "quiet"), false);
});
