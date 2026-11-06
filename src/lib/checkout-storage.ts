type CheckoutStorage = {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function persistCheckoutAttempt<T extends { state: string }>(
  storage: CheckoutStorage,
  key: string,
  attempt: T,
): void {
  if (attempt.state === "cancelled") {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(attempt));
}
