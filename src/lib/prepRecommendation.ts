export type PrepRecommendationItem = {
  itemName: string;
  availableUnits: number;
  unitsSoldLast7Days: number;
};

export function createPrepRecommendation(items: PrepRecommendationItem[]): string {
  if (items.length === 0) return "Add menu items to receive a preparation recommendation.";

  const soldItems = items.filter(({ unitsSoldLast7Days }) => unitsSoldLast7Days > 0);
  if (soldItems.length === 0) return "No menu-item sales were recorded in the last 7 days, so no additional prep is recommended today.";

  const shortages = soldItems
    .map((item) => ({ ...item, shortfall: Math.max(0, item.unitsSoldLast7Days - item.availableUnits) }))
    .filter(({ shortfall }) => shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall);
  if (shortages.length > 0) {
    const summary = shortages.slice(0, 3).map(({ itemName, shortfall }) => `${itemName} (+${shortfall})`).join(", ");
    return `Restock before the next rush: ${summary}.`;
  }

  const topSellers = [...soldItems]
    .sort((a, b) => b.unitsSoldLast7Days - a.unitsSoldLast7Days)
    .slice(0, 3)
    .map(({ itemName, unitsSoldLast7Days, availableUnits }) => `${itemName}: ${unitsSoldLast7Days} sold, ${availableUnits} available`)
    .join(" · ");
  return `Stock covers recent demand. Keep these ready: ${topSellers}.`;
}
