import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../server/config.js";
import { PayPalClient } from "../../server/services/paypal.js";

const config: AppConfig = {
  nodeEnv: "test", port: 4000, appOrigin: "http://127.0.0.1:5173",
  eventName: "Little Harbor Market", eventTimeZone: "Asia/Tokyo", currency: "JPY", databasePath: ":memory:",
  paypalMode: "sandbox", paypalClientId: "sandbox-client", paypalClientSecret: "sandbox-secret", paypalWebhookId: "webhook-id",
  googleCloudProject: null, googleCloudLocation: "global", geminiModel: "test-model",
  adminAccessCode: null, adminSessionSecret: null,
};

test("PayPal webhook verification posts the configured webhook ID, headers, and event", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const responses = [
    new Response(JSON.stringify({ access_token: "unit-token", expires_in: 300 }), { status: 200 }),
    new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }),
  ];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return responses.shift()!;
  };
  const client = new PayPalClient(config, fetcher);
  const headers = { authAlgorithm: "SHA256withRSA", certUrl: "https://api.paypal.com/cert", transmissionId: "transmission-id",
    transmissionSig: "signature", transmissionTime: "2026-11-02T00:00:00Z", webhookId: "ignored-request-id" };
  const event = { id: "event-id", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "capture-id" } };

  assert.equal(await client.verifyWebhook(headers, event), true);
  assert.equal(requests[0]?.url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  assert.equal(requests[0]?.init.headers && (requests[0].init.headers as Record<string, string>).Authorization,
    `Basic ${Buffer.from("sandbox-client:sandbox-secret").toString("base64")}`);
  assert.equal(requests[1]?.url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
  const body = JSON.parse(requests[1]?.init.body as string) as Record<string, unknown>;
  assert.deepEqual(body, {
    auth_algo: headers.authAlgorithm, cert_url: headers.certUrl, transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig, transmission_time: headers.transmissionTime,
    webhook_id: "webhook-id", webhook_event: event,
  });
});

test("PayPal webhook verification fails closed without a configured webhook ID", async () => {
  let requests = 0;
  const client = new PayPalClient({ ...config, paypalWebhookId: null }, async () => {
    requests += 1;
    return new Response("unexpected", { status: 500 });
  });
  assert.equal(await client.verifyWebhook({ authAlgorithm: "", certUrl: "", transmissionId: "", transmissionSig: "", transmissionTime: "", webhookId: "" }, {}), false);
  assert.equal(requests, 0);
});

test("PayPal capture reads custom ID from the captured payment when absent from the purchase unit", async () => {
  const responses = [
    new Response(JSON.stringify({ access_token: "unit-token", expires_in: 300 }), { status: 200 }),
    new Response(JSON.stringify({
      id: "paypal-order-1", status: "COMPLETED", purchase_units: [{
        reference_id: "local-order-1", amount: { currency_code: "JPY", value: "300" },
        payments: { captures: [{
          id: "capture-1", status: "COMPLETED", custom_id: "local-order-1",
          amount: { currency_code: "JPY", value: "300" },
        }] },
      }],
    }), { status: 201 }),
  ];
  const client = new PayPalClient(config, async () => responses.shift()!);

  const captured = await client.captureOrder("paypal-order-1", "capture-request-1");

  assert.equal(captured.orderId, "paypal-order-1");
  assert.equal(captured.referenceId, "local-order-1");
  assert.equal(captured.customId, "local-order-1");
  assert.equal(captured.captureStatus, "COMPLETED");
  assert.equal(captured.currency, "JPY");
  assert.equal(captured.amountMinor, 300);
});
