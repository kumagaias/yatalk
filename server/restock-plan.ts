export const RESTOCK_LOOKBACK_DAYS = 7;
export const RESTOCK_TARGET_DAYS = 2;
export const RESTOCK_MINIMUM_BUFFER = 5;

const INVENTORY_QUESTION = /\b(?:stock|inventory|restock|replenish|reorder|sold\s*out|run(?:ning)?\s*out|best[-\s]?sell(?:er|ing|ers)?|top[-\s]?sell(?:er|ing|ers)?|sold\s+(?:the\s+)?most|most\s+popular)\b|在庫|補充|品切れ|売り切れ|品薄|仕入れ|仕入|発注|再注文|売れ筋|売上|販売数|販売実績|売れ|人気/i;

export function isInventoryQuestion(question: string): boolean {
  return INVENTORY_QUESTION.test(question);
}

export type RestockRecommendation = {
  id: string;
  name: string;
  available: number;
  unitsSoldLast7Days: number;
  averageDailySales: number;
  daysOfCover: number;
  targetStock: number;
  suggestedQuantity: number;
};

type StockProduct = { id: string; name: string; available: number };
type SalesRow = { id: string; units_sold: number };

export function buildRestockPlan(products: StockProduct[], sales: SalesRow[]): RestockRecommendation[] {
  const salesById = new Map(sales.map(({ id, units_sold }) => [id, units_sold]));
  return products.flatMap((product) => {
    const unitsSoldLast7Days = salesById.get(product.id) ?? 0;
    if (unitsSoldLast7Days <= 0) return [];
    const averageDailySales = unitsSoldLast7Days / RESTOCK_LOOKBACK_DAYS;
    const targetStock = Math.min(999, Math.max(RESTOCK_MINIMUM_BUFFER, Math.ceil(averageDailySales * RESTOCK_TARGET_DAYS)));
    if (product.available >= targetStock) return [];
    return [{
      id: product.id,
      name: product.name,
      available: product.available,
      unitsSoldLast7Days,
      averageDailySales: Math.round(averageDailySales * 10) / 10,
      daysOfCover: Math.round((product.available / averageDailySales) * 10) / 10,
      targetStock,
      suggestedQuantity: targetStock - product.available,
    }];
  }).sort((left, right) => left.daysOfCover - right.daysOfCover || right.unitsSoldLast7Days - left.unitsSoldLast7Days || left.available - right.available);
}
