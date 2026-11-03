import type { AppConfig } from "../config.js";
import { ProviderError } from "../errors.js";

export interface PayPalLineItem { id: string; name: string; quantity: number; unitAmount: number }
export interface PayPalOrderInput { localOrderId: string; currency: string; totalMinor: number; items: PayPalLineItem[]; requestId: string }
export interface PayPalOrderResult { id: string; status: string; approveUrl: string | null }
export interface PayPalCaptureResult {
  orderId: string; orderStatus: string; referenceId: string | null; customId: string | null;
  captureId: string | null; captureStatus: string | null; currency: string | null; amountMinor: number | null;
}
export interface PayPalRefundResult { refundId: string | null; status: string; currency: string | null; amountMinor: number | null }
export interface WebhookHeaders {
  authAlgorithm: string; certUrl: string; transmissionId: string; transmissionSig: string;
  transmissionTime: string; webhookId: string;
}

export interface PayPalProvider {
  createOrder(input: PayPalOrderInput): Promise<PayPalOrderResult>;
  getOrder(orderId: string): Promise<PayPalCaptureResult>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalCaptureResult>;
  refundCapture(captureId: string, amountMinor: number, currency: string, requestId: string): Promise<PayPalRefundResult>;
  verifyWebhook(headers: WebhookHeaders, event: unknown): Promise<boolean>;
}

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord { return value && typeof value === "object" ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }

function parseAmount(value: unknown): { currency: string | null; minor: number | null } {
  const amount = record(value);
  const currency = string(amount.currency_code);
  const parsed = typeof amount.value === "string" && /^\d+(?:\.\d{1,2})?$/.test(amount.value) ? Number(amount.value) : NaN;
  return { currency, minor: Number.isSafeInteger(parsed) ? parsed : null };
}

function firstPurchaseUnit(body: unknown): JsonRecord {
  return record(array(record(body).purchase_units)[0]);
}

function extractCapture(orderId: string, body: unknown): PayPalCaptureResult {
  const root = record(body);
  const unit = firstPurchaseUnit(body);
  const capture = record(array(record(unit.payments).captures)[0]);
  const amount = parseAmount(capture.amount ?? unit.amount);
  return {
    orderId: string(root.id) ?? orderId,
    orderStatus: string(root.status) ?? "UNKNOWN",
    referenceId: string(unit.reference_id), customId: string(unit.custom_id),
    captureId: string(capture.id), captureStatus: string(capture.status),
    currency: amount.currency, amountMinor: amount.minor,
  };
}

export class PayPalClient implements PayPalProvider {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl = "https://api-m.sandbox.paypal.com";

  constructor(private readonly config: AppConfig, private readonly fetcher: FetchLike = fetch) {}

  private configured(): void {
    if (!this.config.paypalClientId || !this.config.paypalClientSecret) throw new ProviderError("paypal", "configuration", true, 503);
  }

  private async token(): Promise<string> {
    this.configured();
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.value;
    let response: Response;
    try {
      const basic = Buffer.from(`${this.config.paypalClientId}:${this.config.paypalClientSecret}`).toString("base64");
      response = await this.fetcher(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials", signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ProviderError("paypal", "token", false);
    }
    if (!response.ok) throw new ProviderError("paypal", "token", response.status < 500, response.status);
    const payload = record(await response.json());
    if (typeof payload.access_token !== "string") throw new ProviderError("paypal", "token_response", false);
    const expiresSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 300;
    this.accessToken = { value: payload.access_token, expiresAt: Date.now() + expiresSeconds * 1000 };
    return payload.access_token;
  }

  private async request(path: string, method: string, body?: unknown, requestId?: string): Promise<JsonRecord> {
    const token = await this.token();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`, Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ProviderError("paypal", method === "GET" ? "read" : "mutation", false);
    }
    if (!response.ok) throw new ProviderError("paypal", method === "GET" ? "read" : "mutation", response.status >= 400 && response.status < 500 && response.status !== 429, response.status);
    if (response.status === 204) return {};
    try { return record(await response.json()); }
    catch { throw new ProviderError("paypal", "response_parse", false); }
  }

  async createOrder(input: PayPalOrderInput): Promise<PayPalOrderResult> {
    const toValue = (minor: number) => minor.toString();
    const payload = await this.request("/v2/checkout/orders", "POST", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: input.localOrderId, custom_id: input.localOrderId, invoice_id: input.localOrderId,
        amount: { currency_code: input.currency, value: toValue(input.totalMinor),
          breakdown: { item_total: { currency_code: input.currency, value: toValue(input.totalMinor) } } },
        items: input.items.map((item) => ({
          name: item.name.slice(0, 127), quantity: String(item.quantity),
          unit_amount: { currency_code: input.currency, value: toValue(item.unitAmount) },
        })),
      }],
      payment_source: undefined,
    }, input.requestId);
    const links = array(payload.links).map(record);
    const approveUrl = links.find((link) => link.rel === "approve" || link.rel === "payer-action");
    if (typeof payload.id !== "string") throw new ProviderError("paypal", "create_response", false);
    return { id: payload.id, status: string(payload.status) ?? "UNKNOWN", approveUrl: string(approveUrl?.href) };
  }

  async getOrder(orderId: string): Promise<PayPalCaptureResult> {
    const payload = await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, "GET");
    return extractCapture(orderId, payload);
  }

  async captureOrder(orderId: string, requestId: string): Promise<PayPalCaptureResult> {
    const payload = await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "POST", {}, requestId);
    return extractCapture(orderId, payload);
  }

  async refundCapture(captureId: string, amountMinor: number, currency: string, requestId: string): Promise<PayPalRefundResult> {
    const payload = await this.request(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, "POST", {
      amount: { currency_code: currency, value: amountMinor.toString() },
    }, requestId);
    const amount = parseAmount(payload.amount);
    return { refundId: string(payload.id), status: string(payload.status) ?? "UNKNOWN", currency: amount.currency, amountMinor: amount.minor };
  }

  async verifyWebhook(headers: WebhookHeaders, event: unknown): Promise<boolean> {
    if (!this.config.paypalWebhookId) return false;
    try {
      const payload = await this.request("/v1/notifications/verify-webhook-signature", "POST", {
        auth_algo: headers.authAlgorithm, cert_url: headers.certUrl,
        transmission_id: headers.transmissionId, transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime, webhook_id: this.config.paypalWebhookId,
        webhook_event: event,
      });
      return payload.verification_status === "SUCCESS";
    } catch (error) {
      if (error instanceof ProviderError && error.definite) return false;
      throw error;
    }
  }
}
