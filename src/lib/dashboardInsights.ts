export type SalesTrendPoint = { date: string; netSales: number };

export type InsightItem = {
  itemName: string;
  availableUnits: number;
  unitsSoldLast7Days: number;
};

export type StockProjection = {
  itemName: string;
  daysOfCover: number | null;
  projectedAvailable: number[];
};

export type DashboardRecommendation = {
  title: string;
  detail: string;
  tone: "urgent" | "ready" | "quiet";
};

export function salesForecast(trend: SalesTrendPoint[]): number | null {
  if (trend.length === 0 || trend.every(({ netSales }) => netSales === 0)) return null;
  return trend.reduce((total, { netSales }) => total + netSales, 0) / trend.length;
}

export function stockProjection(items: InsightItem[], days = 7): StockProjection | null {
  const sellingItems = items.filter(({ unitsSoldLast7Days }) => unitsSoldLast7Days > 0);
  if (sellingItems.length === 0) return null;
  const item = [...sellingItems].sort((left, right) => {
    const leftCover = left.availableUnits / left.unitsSoldLast7Days;
    const rightCover = right.availableUnits / right.unitsSoldLast7Days;
    return leftCover - rightCover || right.unitsSoldLast7Days - left.unitsSoldLast7Days;
  })[0]!;
  const dailyDemand = item.unitsSoldLast7Days / 7;
  return {
    itemName: item.itemName,
    daysOfCover: dailyDemand > 0 ? item.availableUnits / dailyDemand : null,
    projectedAvailable: Array.from({ length: days + 1 }, (_, day) => Math.max(0, item.availableUnits - dailyDemand * day)),
  };
}

export function dashboardRecommendations(items: InsightItem[]): DashboardRecommendation[] {
  if (items.length === 0) return [{ title: "Add your menu", detail: "Item-level stock recommendations appear after menu items are added.", tone: "quiet" }];
  const selling = items.filter(({ unitsSoldLast7Days }) => unitsSoldLast7Days > 0);
  if (selling.length === 0) return [{ title: "Sales signal needed", detail: "Recommendations will appear after your first captured sale.", tone: "quiet" }];
  return [...selling]
    .map((item) => ({ ...item, daysOfCover: item.availableUnits / (item.unitsSoldLast7Days / 7) }))
    .sort((left, right) => left.daysOfCover - right.daysOfCover || right.unitsSoldLast7Days - left.unitsSoldLast7Days)
    .slice(0, 3)
    .map((item) => item.daysOfCover < 2
      ? { title: `Restock ${item.itemName}`, detail: `${item.availableUnits} available covers about ${formatCover(item.daysOfCover)} of recent demand.`, tone: "urgent" as const }
      : { title: `Keep ${item.itemName} ready`, detail: `${item.unitsSoldLast7Days} sold in 7 days; about ${formatCover(item.daysOfCover)} of stock cover remains.`, tone: "ready" as const });
}

function formatCover(days: number): string {
  return `${days < 1 ? "less than 1" : Math.floor(days)} day${days >= 2 ? "s" : ""}`;
}
