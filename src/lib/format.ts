export function money(amountMinor: number, currency = "JPY"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amountMinor / (currency === "JPY" ? 1 : 100));
}

export function shortTime(value?: string): string {
  if (!value) return "Just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo",
  }).format(date);
}

export function createRequestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
