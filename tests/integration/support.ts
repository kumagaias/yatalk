import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../../server/app.js";
import type { AppConfig } from "../../server/config.js";
import { createDatabase } from "../../server/database.js";
import type { FirestoreDb } from "../../server/database.js";
import { createFirestoreDatabase, initializeFirestoreDatabase } from "../../server/firestore-bootstrap.js";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../../server/errors.js";
import type { AiProvider } from "../../server/services/ai.js";
import type { EmailSender, TransactionalEmail } from "../../server/email.js";
import type { ShopImageStorage, StoredShopImage } from "../../server/shop-image-storage.js";
import type { PayPalCaptureResult, PayPalOrderInput, PayPalProvider, PayPalRefundResult, WebhookHeaders } from "../../server/services/paypal.js";

export const origin = "http://127.0.0.1:5173";

function config(): AppConfig {
  return {
    nodeEnv: "test", port: 4000, appOrigin: origin,
    eventName: "Little Harbor Market", eventTimeZone: "Asia/Tokyo", currency: "JPY", databaseBackend: "sqlite", databasePath: ":memory:",
    paypalMode: "sandbox", paypalClientId: "test-client", paypalClientSecret: "test-secret", paypalWebhookId: "test-webhook",
    googleCloudProject: null, googleCloudLocation: "global", geminiModel: "test-model",
    adminAccessCode: "local-test-code!!", adminSessionSecret: "test-session-secret",
    resendApiKey: null, resendFromEmail: null,
    shopImageBucket: null,
  };
}

export class FakePayPal implements PayPalProvider {
  createCalls: PayPalOrderInput[] = [];
  captureCalls: string[] = [];
  captureRequestIds: string[] = [];
  refundCalls: string[] = [];
  refundRequestIds: string[] = [];
  verifyCalls = 0;
  getOrderCalls = 0;
  orders = new Map<string, { localOrderId: string; total: number; currency: string; completed: boolean }>();
  failFirstCreate = false;
  failFirstCapture = false;
  failFirstRefund = false;
  mismatchAmount = false;
  omitOrderReferences = false;
  referenceIdOverride: string | null = null;
  customIdOverride: string | null = null;
  allowWebhook = true;
  failWebhookVerification = false;
  verificationDelayMs = 0;
  getOrderGate: Promise<void> | null = null;
  onGetOrder: (() => void) | null = null;
  orderStatusOverride: string | null = null;
  approveUrl: string | null = null;

  private orderReferences(localOrderId: string) {
    return this.omitOrderReferences
      ? { referenceId: null, customId: null }
      : { referenceId: this.referenceIdOverride ?? localOrderId, customId: this.customIdOverride ?? localOrderId };
  }

  async createOrder(input: PayPalOrderInput) {
    this.createCalls.push(input);
    if (this.failFirstCreate && this.createCalls.length === 1) throw new ProviderError("paypal", "mutation", false);
    const id = `PAYPAL-${input.localOrderId}`;
    this.orders.set(id, { localOrderId: input.localOrderId, total: input.totalMinor, currency: input.currency, completed: false });
    return { id, status: "CREATED", approveUrl: this.approveUrl };
  }
  async getOrder(orderId: string): Promise<PayPalCaptureResult> {
    this.getOrderCalls += 1;
    this.onGetOrder?.();
    if (this.getOrderGate) await this.getOrderGate;
    const order = this.orders.get(orderId)!;
    return { orderId, orderStatus: this.orderStatusOverride ?? (order.completed ? "COMPLETED" : "APPROVED"),
      ...this.orderReferences(order.localOrderId),
      captureId: order.completed ? `CAPTURE-${order.localOrderId}` : null,
      captureStatus: order.completed ? "COMPLETED" : null, currency: order.currency, amountMinor: order.total + (this.mismatchAmount ? 1 : 0) };
  }
  async captureOrder(orderId: string, requestId: string): Promise<PayPalCaptureResult> {
    this.captureCalls.push(orderId);
    this.captureRequestIds.push(requestId);
    if (this.failFirstCapture && this.captureCalls.length === 1) throw new ProviderError("paypal", "mutation", false);
    const order = this.orders.get(orderId)!;
    order.completed = true;
    return { orderId, orderStatus: "COMPLETED", ...this.orderReferences(order.localOrderId),
      captureId: `CAPTURE-${order.localOrderId}`, captureStatus: "COMPLETED", currency: order.currency,
      amountMinor: order.total + (this.mismatchAmount ? 1 : 0) };
  }
  async refundCapture(captureId: string, amountMinor: number, currency: string, requestId: string): Promise<PayPalRefundResult> {
    this.refundCalls.push(captureId);
    this.refundRequestIds.push(requestId);
    if (this.failFirstRefund && this.refundCalls.length === 1) throw new ProviderError("paypal", "mutation", false);
    return { refundId: `REFUND-${captureId}`, status: "COMPLETED", currency, amountMinor };
  }
  async verifyWebhook(_headers: WebhookHeaders, _event: unknown): Promise<boolean> {
    this.verifyCalls += 1;
    if (this.verificationDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.verificationDelayMs));
    if (this.failWebhookVerification) throw new ProviderError("paypal", "webhook_verification", false);
    return this.allowWebhook;
  }
}

const fakeAi: AiProvider = {
  async interpretCart() { return { reply: "I can help with that.", clarification: null, operations: [] }; },
  async explainFacts(_question, facts) {
    const source = facts as { restockCandidates?: Array<{ id: string }>; lowStockItems?: Array<{ id: string }> };
    const candidates = source.restockCandidates ?? source.lowStockItems ?? [];
    return { answer: "Sales and stock are based on the dashboard figures.", restockPriorityIds: candidates.slice(0, 5).map(({ id }) => id) };
  },
  async assistMenu() { return { reply: "Here is a draft to review.", suggestions: [
    { name: "Citrus tea", description: "A bright tea idea", priceMinor: null, dietaryNote: "" },
  ] }; },
  async transcribeAudio() { return "Two yakisoba and one iced tea"; },
  async extractMenu() { return { items: [
    { name: "Grilled Onigiri", description: "", priceMinor: 400, dietaryNote: "Contains soy" },
    { name: "Iced Tea", description: "", priceMinor: 300, dietaryNote: "" },
    { name: "Mikan Jelly", description: "", priceMinor: 500, dietaryNote: "" },
  ] }; },
};

export class FakeEmailSender implements EmailSender {
  readonly messages: TransactionalEmail[] = [];
  async send(email: TransactionalEmail) { this.messages.push(email); }
}

export class FakeShopImageStorage implements ShopImageStorage {
  readonly images = new Map<string, StoredShopImage>();
  async put(shopId: string, image: StoredShopImage) { this.images.set(shopId, { data: Buffer.from(image.data), mimeType: image.mimeType }); }
  async get(shopId: string) {
    const image = this.images.get(shopId);
    return image ? { data: Buffer.from(image.data), mimeType: image.mimeType } : undefined;
  }
}

export async function withServer<T>(paypal: FakePayPal, work: (url: string, db: ReturnType<typeof createDatabase>) => Promise<T>, assistant: AiProvider = fakeAi, emailSender: EmailSender = new FakeEmailSender(), shopImageStorage: ShopImageStorage | null = null): Promise<T> {
  const db = createDatabase(":memory:");
  const app = createApp({ config: config(), db, paypal, ai: assistant, emailSender, shopImageStorage, serveStatic: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  try { return await work(`http://127.0.0.1:${address.port}`, db); }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    db.close();
  }
}

export async function withFirestoreServer<T>(
  paypal: FakePayPal,
  work: (url: string, db: FirestoreDb) => Promise<T>,
  assistant: AiProvider = fakeAi,
  projectId = `yatalk-test-${randomUUID().slice(0, 8)}`,
  emailSender: EmailSender = new FakeEmailSender(),
): Promise<T> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required for Firestore integration tests");
  const db = createFirestoreDatabase(projectId);
  await initializeFirestoreDatabase(db);
  const app = createApp({ config: { ...config(), databaseBackend: "firestore", googleCloudProject: projectId }, db, paypal, ai: assistant, emailSender, serveStatic: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  try { return await work(`http://127.0.0.1:${address.port}`, db); }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    await db.firestoreStore.client.terminate();
    db.close();
  }
}

export async function json(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!text) throw new Error(`Expected a JSON response from ${new URL(url).pathname}`);
  return { response, body: JSON.parse(text) as Record<string, any> };
}

export async function visitorSession(url: string) {
  const { response, body } = await json(`${url}/api/cart`);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return { cookie: setCookie.split(";", 1)[0]!, cart: body };
}

export function postHeaders(cookie: string) {
  return { cookie, origin, "content-type": "application/json" };
}
