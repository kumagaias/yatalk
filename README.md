# Yatalk

Yatalk helps local shops take orders through conversation. Owners create path-based storefronts, add menu items from a photo or by hand, and share a QR code. Visitors can browse, order by voice or chat, review the server-priced cart, and pay in PayPal Sandbox. Each shop has its own cart, inventory, orders, and operations dashboard.

## How it works

1. A stall owner displays a permanent counter QR code. It opens that shop with `?counter=1`.
2. A customer opens the menu on their own phone, speaks or types an order, reviews the cart, and checks out with PayPal.
3. The server creates and captures a PayPal order, then issues a pickup number. The owner sees the paid order in the counter queue.

## PayPal, AI, and sponsor integrations

| Integration | How Yatalk uses it |
|---|---|
| **PayPal Orders API and JavaScript SDK** | The server creates an order from the authoritative cart total, and the customer approves payment on their own device. Yatalk captures the approved order server-side, validates the result, records a pickup number, and verifies PayPal webhooks to cover return-page drop-off. The hackathon deployment uses **PayPal Sandbox** only. |
| **Google Gemini on Vertex AI** | Gemini reads owner-supplied menu photos, transcribes short voice clips, turns multilingual speech or text into validated cart operations, and writes the natural customer reply in the browser language. Menu items and stock are supplied as context; Gemini never sets prices, captures payments, refunds, or edits inventory. |
| **AG Studio (AG Grid)** | The owner dashboard sends read-only, shop-scoped aggregates to Gemini. Gemini can compose and refine sales and stock visual reports in AG Studio without access to customer details or transaction controls. |
| **Google Cloud Run, Firestore, and Cloud Storage** | Cloud Run hosts the app; Firestore stores owner shops, carts, orders, and inventory; Cloud Storage holds optional shop-cover uploads. |

The project is deliberately reviewable: customers confirm recognized orders and the calculated cart before PayPal, while owners review every OCR menu suggestion before publishing it.

## Requirements

- Node.js 24.22.x
- npm
- A PayPal Developer account with a Sandbox REST app and buyer/seller accounts
- A Google Cloud project with billing enabled and the Vertex AI API enabled

## Run locally

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Set the values from `.env.example`. Generate an admin session secret locally, for example with `openssl rand -hex 32`. Never commit `.env`.

3. Create a PayPal Sandbox REST app and set its client ID and secret. Set the sandbox seller account to accept JPY or automatically convert incoming JPY. JPY is a zero-decimal currency; Yatalk uses whole-yen amounts.

4. Enable the Vertex AI API in the `s-yatalk` project and authenticate local Application Default Credentials with an identity that can call Vertex AI. For example, run `gcloud auth application-default login`. Set `GOOGLE_CLOUD_PROJECT=s-yatalk`, `GOOGLE_CLOUD_LOCATION=global`, and `GEMINI_MODEL=gemini-3.5-flash-lite`.

5. Set `ADMIN_ACCESS_CODE` to a random passphrase of at least 16 characters and `ADMIN_SESSION_SECRET` to at least 32 random bytes.

6. Start the app:

   ```sh
   npm run dev
   ```

7. Open <http://127.0.0.1:5173>. Create a sample shop at `/shops/new`, open the Little Harbor example at `/shops/little-harbor-market`, or sign in at `/dashboard/login`. The original `/organizer` login remains for the Little Harbor demo.

The app seeds fictional Little Harbor Market products on first run. Newly created shops start with an empty menu. Owners can send a JPEG, PNG, WebP, HEIC, or HEIF menu photo (up to 4 MB) to Google Cloud for OCR suggestions, then edit item details and enter stock counts before saving. Photos are not stored by Yatalk. Owners can also enter every item manually. Each dashboard has a locally generated QR code that opens its public shop page. Local SQLite data is stored in `.data/` and is ignored by Git. Voice recordings up to 20 seconds are sent to Google Cloud for transcription. Yatalk does not store recordings; the transcript appears as editable text and must be reviewed before it can be sent as an order. If a required provider is not configured, Yatalk keeps menu browsing and manual cart editing available and clearly disables that provider action. See [the URL and tenant design](docs/yatalk-url-design.md) for routes and prototype limitations.

## Environment variables

| Variable | Purpose |
|---|---|
| `APP_PORT` | Local API/server port (default 4000) |
| `APP_ORIGIN` | Exact browser origin allowed for state-changing requests (`http://127.0.0.1:5173` locally) |
| `EVENT_TIME_ZONE` | Time zone for the organizer’s “today” totals (`Asia/Tokyo`) |
| `PAYPAL_MODE` | `sandbox` for this demo |
| `PAYPAL_CLIENT_ID` | PayPal Sandbox public client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox server credential; keep private |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from the PayPal app configuration |
| `PAYPAL_CURRENCY` | Event currency (`JPY`) |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project used for Vertex AI (default example: `s-yatalk`) |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI endpoint location (`global` for the selected Flash-Lite model) |
| `GOOGLE_GENAI_USE_ENTERPRISE` | Selects the Google Cloud Vertex AI backend for the Gen AI SDK |
| `GEMINI_MODEL` | Vertex AI model for menu OCR, chat, and audio transcription (`gemini-3.5-flash-lite`) |
| `ADMIN_ACCESS_CODE` | Organizer login passphrase (minimum 16 characters) |
| `ADMIN_SESSION_SECRET` | Random secret used to sign expiring organizer cookies |
| `RESEND_API_KEY` | Optional Resend sending key for owner verification and password-reset email; never expose it in the browser or commit it |
| `RESEND_FROM_EMAIL` | Optional verified Resend sender, for example `noreply@kumagaias.com` |

Email delivery is disabled until both Resend variables are set. In Cloud Run, add the API key as a Secret Manager version and enable `enable_email_delivery = true` with the verified sender in `infra/environments/prd/prd.auto.tfvars`. Do not paste the key into Terraform variables, source, or Git history.

## Webhooks

For signature-verified webhook testing, configure a public HTTPS endpoint ending in `/api/webhooks/paypal` and subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, and `PAYMENT.CAPTURE.REFUNDED`. The approved event lets the server capture payment if the buyer closes PayPal before returning to Yatalk. Use a real Sandbox capture/refund to verify the signed success path. PayPal Webhook Simulator events are useful for rejection and parsing tests but do not pass PayPal postback signature verification.

## Commands

```sh
npm run dev
npm run build
npm test
```

## Hackathon demo path

1. Create a shop, scan its dashboard QR code, and place an order by voice or chat.
2. Review the recognized request, exact items, and server-calculated total, then approve in PayPal Sandbox.
3. Show the paid receipt and pickup code.
4. Sign in as the organizer and show the new order and changed availability.
5. Ask “What is almost sold out?” and show the database facts beside the AI answer.

Keep the recorded demo under three minutes. The project is designed for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) and follows its [official rules](https://paypalaihackathon.devpost.com/rules). A hosted demo and Devpost submission are separate steps.

## Security notes

- The demo uses PayPal Sandbox only; there is no live-payment mode.
- Sandbox payments go to the one seller account configured for the app. Shop owners sign in to Yatalk and do not connect PayPal in this demo; per-shop settlement requires a separate PayPal partner integration.
- Product prices, order totals, payment status, and inventory decisions are server-authoritative.
- Gemini suggests menu items from photos, transcribes short voice recordings, interprets order text, and explains computed summaries. Owners review menu suggestions and set stock; buyers review transcripts and cart changes. Gemini cannot capture a payment, issue a refund, or edit stock.
- Vertex AI usage is billed to the selected Google Cloud project. As of 2026-11-02, Gemini 3.5 Flash-Lite Standard PayGo on the global endpoint is listed at $0.30 per million input tokens and $2.50 per million output tokens; check [current pricing](https://cloud.google.com/model-garden/pricing) before use because rates can change. Terraform declares global input-token quota preferences for `gemini-3.5-flash-lite-qcd` at 10,000 tokens per minute and 50,000 tokens per day; after applying, verify `granted_value` and `reconciling` before relying on the limits. These preferences do not limit output tokens or other project charges. The selected `global` endpoint is not a Tokyo-only processing location. Terraform also sets a ¥5,000 monthly project budget alert at 50%, 80%, 100%, and forecasted 100%; it sends notifications and does not cap spending.
- Customers are not asked for names, email addresses, or payment details by Yatalk; shop owners provide an email address for account sign-in.
- Never commit `.env`, cloud credentials, tokens, database files, or Sandbox login credentials.

## Google Cloud infrastructure

Yatalk is a hackathon prototype, so Terraform uses only `infra/environments/prd` to avoid duplicate environments and costs. The GCS backend stores state at `yatalk/prd` in the existing protected bucket `yatalk-dev-tfstate-s-yatalk`. Existing cloud resource IDs retain their `dev` names to preserve the deployed preview without creating a second service or bucket. Terraform manages Vertex AI, Cloud Quotas, Cloud Run, Artifact Registry, Cloud Build, and PayPal Sandbox and organizer secret metadata. The current preview is public for the demo and its API can incur Vertex AI charges. The ¥5,000 budget is an alert, not a spending cap. PayPal Sandbox capture/refund webhooks are configured; full payment verification still needs a Sandbox buyer transaction. To sign in as organizer, retrieve the access code directly with `gcloud secrets versions access latest --secret=yatalk-admin-access-code --project=s-yatalk`; do not copy it into `.env` or `.tfvars`. The state bucket was bootstrapped with Terraform and imported into remote state. See [the PRD environment guide](infra/environments/prd/README.md) for the staged image build and apply sequence.

The single Cloud Run service remains a hackathon preview. In production mode, shop accounts, storefronts, menus, carts, and orders use the Firestore Standard default database in `asia-northeast1`; they survive Cloud Run restarts and revisions. Firestore has a usage-based free quota for one database per project (currently 1 GiB stored data, 50,000 reads, 20,000 writes, and 20,000 deletes per day, plus 10 GiB monthly outbound transfer). Usage above the free quota is billed, and managed TTL deletions used for expired sessions and carts are not included in the free quota. See [Firestore pricing](https://cloud.google.com/firestore/pricing) and [quotas](https://docs.cloud.google.com/firestore/quotas) for current terms. The existing ¥5,000 project budget sends alerts; it does not stop spending. The app's per-IP and per-session rate limits still live in process memory. The current preview uses PayPal Sandbox and is configured for demo orders.

This rollout did not import records from the preview's temporary SQLite file. At cutover, the public `test` shop menu returned 404. Any owner login or custom shop held only in that SQLite file is not present in Firestore; the owner may need to register again. The Firestore backend now starts with the seeded sample storefront.

## Demo screenshots

The latest preview captures are in [`docs/demo/`](docs/demo/). They document the responsive interface; they do not prove a completed PayPal transaction.

## License

MIT. See [LICENSE](LICENSE).
