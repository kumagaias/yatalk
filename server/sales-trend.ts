export type CapturedSale = {
  capturedAt: string;
  totalMinor: number;
  state: string;
};

export type DailySalesPoint = {
  date: string;
  netSalesMinor: number;
};

function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dailySalesTrend(now: Date, timeZone: string, days: number, sales: CapturedSale[]): DailySalesPoint[] {
  const safeDays = Math.max(1, Math.floor(days));
  const totals = new Map<string, number>();
  for (const sale of sales) {
    if (!["paid", "collected", "refund_unknown"].includes(sale.state)) continue;
    const date = localDateKey(new Date(sale.capturedAt), timeZone);
    totals.set(date, (totals.get(date) ?? 0) + sale.totalMinor);
  }

  const latest = localDateKey(now, timeZone).split("-").map(Number);
  return Array.from({ length: safeDays }, (_, index) => {
    const calendarDay = new Date(Date.UTC(latest[0]!, latest[1]! - 1, latest[2]! - safeDays + index + 1));
    const date = calendarDay.toISOString().slice(0, 10);
    return { date, netSalesMinor: totals.get(date) ?? 0 };
  });
}
