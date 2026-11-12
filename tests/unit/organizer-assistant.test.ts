import assert from "node:assert/strict";
import test from "node:test";
import { answerLiveShopQuestion } from "../../server/organizer-assistant.js";

const facts = {
  currency: "USD",
  netCapturedMinor: 1250,
  paidUncollectedOrders: [{ pickupCode: "007", items: [{ name: "Iced Tea", quantity: 1 }, { name: "Hot Dog", quantity: 2 }] }],
  salesTrend: [{ netSalesMinor: 500 }, { netSalesMinor: 1500 }],
};

test("live shop questions answer sales, pickup, next menu, and forecast without an AI call", () => {
  assert.equal(answerLiveShopQuestion("What are today's sales?", facts), "Today's net sales are $12.50.");
  assert.equal(answerLiveShopQuestion("お金を払ったのにまだ受け取っていないお客さんは？", facts), "支払い済みで未受取のお客さまは 1 件です。受取番号: 007。");
  assert.equal(answerLiveShopQuestion("What is the next customer's menu?", facts), "The next pickup is 007: Iced Tea ×1, Hot Dog ×2.");
  assert.equal(answerLiveShopQuestion("売上予測を教えて", facts), "直近 2 日の平均純売上に基づく明日の売上見込みは $10.00 です。これは目安であり、保証ではありません。");
});

test("live shop answers leave unrelated questions for the AI assistant", () => {
  assert.equal(answerLiveShopQuestion("Which item should I restock?", facts), null);
});
