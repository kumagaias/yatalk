import { formatMinor } from "../shared/currency.js";

type SalePoint = { netSalesMinor: number };
type PickupOrder = { pickupCode: string | null; items: Array<{ name: string; quantity: number }> };
export type OrganizerLiveFacts = {
  currency: string;
  netCapturedMinor: number;
  paidUncollectedOrders: PickupOrder[];
  salesTrend: SalePoint[];
};

function isJapanese(question: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(question);
}

function itemList(items: PickupOrder["items"]): string {
  return items.map((item) => `${item.name} ×${item.quantity}`).join(", ");
}

export function answerLiveShopQuestion(question: string, facts: OrganizerLiveFacts): string | null {
  const text = question.trim();
  const japanese = isJapanese(text);
  if (/(?:今日.*売上|today.*(?:sales|revenue)|(?:sales|revenue).*today)/iu.test(text)) {
    const amount = formatMinor(facts.netCapturedMinor, facts.currency, japanese ? "ja-JP" : "en-US");
    return japanese ? `今日の純売上は ${amount} です。` : `Today's net sales are ${amount}.`;
  }
  if (/(?:未受取|未受け取|受け取.*いない|uncollected|not.*collected|paid.*not.*(?:collected|picked))/iu.test(text)) {
    const count = facts.paidUncollectedOrders.length;
    if (count === 0) return japanese ? "支払い済みで未受取のお客さまはいません。" : "There are no paid orders awaiting pickup.";
    const codes = facts.paidUncollectedOrders.map((order) => order.pickupCode ?? "—").join(", ");
    return japanese ? `支払い済みで未受取のお客さまは ${count} 件です。受取番号: ${codes}。` : `${count} paid order${count === 1 ? " is" : "s are"} awaiting pickup. Pickup code${count === 1 ? "" : "s"}: ${codes}.`;
  }
  if (/(?:次.*(?:お客|注文|メニュー)|next.*(?:customer|order|menu))/iu.test(text)) {
    const next = facts.paidUncollectedOrders[0];
    if (!next) return japanese ? "現在、支払い済みで次にお渡しする注文はありません。" : "There is no paid order waiting for pickup right now.";
    const code = next.pickupCode ?? "";
    return japanese ? `次のお客さまの受取番号は ${code || "—"} で、${itemList(next.items)} です。` : `The next pickup${code ? ` is ${code}` : ""}: ${itemList(next.items)}.`;
  }
  if (/(?:売上予測|売上.*(?:予想|見込み)|forecast.*sales|sales.*forecast|estimate.*sales)/iu.test(text)) {
    const average = facts.salesTrend.length ? Math.round(facts.salesTrend.reduce((sum, point) => sum + point.netSalesMinor, 0) / facts.salesTrend.length) : 0;
    const amount = formatMinor(average, facts.currency, japanese ? "ja-JP" : "en-US");
    return japanese ? `直近 ${facts.salesTrend.length} 日の平均純売上に基づく明日の売上見込みは ${amount} です。これは目安であり、保証ではありません。` : `Based on the average net sales across the last ${facts.salesTrend.length} days, tomorrow's estimate is ${amount}. This is an estimate, not a guarantee.`;
  }
  return null;
}
