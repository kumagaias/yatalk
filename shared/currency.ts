export const SUPPORTED_CURRENCIES = ["AUD", "CAD", "EUR", "GBP", "JPY", "SGD", "USD"] as const;
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function currencyDigits(currency: string): number {
  return currency === "JPY" ? 0 : 2;
}

export function parseAmountToMinor(value: string, currency: string): number | null {
  if (!isCurrencyCode(currency)) return null;
  const digits = currencyDigits(currency);
  const pattern = digits === 0 ? /^(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
  if (!pattern.test(value.trim())) return null;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * (digits === 0 ? 1 : 100) + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function amountFromMinor(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.trunc(minor / 100);
  const fraction = String(Math.abs(minor % 100)).padStart(digits, "0");
  return `${whole}.${fraction}`;
}

export function formatMinor(minor: number, currency: string, locale = "en-US"): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(minor / (digits === 0 ? 1 : 100));
}

export function minorToProviderAmount(minor: number, currency: string): string {
  return amountFromMinor(minor, currency);
}
