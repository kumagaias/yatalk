import type { OrderState } from "../types";

export function isReceiptReady(state: OrderState | undefined, pickupCode: string | null | undefined): pickupCode is string {
  return (state === "paid" || state === "collected") && typeof pickupCode === "string" && pickupCode.length > 0;
}
