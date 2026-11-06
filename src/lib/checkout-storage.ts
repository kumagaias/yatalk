type CheckoutStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function checkoutStorageKey(shopSlug: string): string {
  return `yatalk.checkout.v1:${encodeURIComponent(shopSlug)}`;
}

export function readCheckoutAttempt(storage: CheckoutStorage, shopSlug: string): string | null {
  // Legacy entries have no shop identity, so they cannot be safely restored.
  return storage.getItem(checkoutStorageKey(shopSlug));
}

export function persistCheckoutAttempt<T extends { state: string }>(
  storage: Pick<CheckoutStorage, "setItem" | "removeItem">,
  key: string,
  attempt: T,
): void {
  if (attempt.state === "cancelled") {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(attempt));
}
