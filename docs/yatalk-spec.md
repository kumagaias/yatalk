# Yatalk — product and implementation design

- **Status:** reviewed implementation specification
- **Date:** 2026-10-29
- **Hackathon:** [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/)
- **Submission deadline:** Nov 12, 2026 at 12:00 PM Pacific (Nov 13 at 05:00 JST)

## 1. Product decision

Yatalk is a conversational checkout and lightweight operations desk for local shops and one-day community markets. Owners create path-based shop pages; each visitor describes what they want in plain language, reviews a shop-priced cart, and pays through PayPal. Each shop's owner manages its stock and orders, then asks an AI assistant questions grounded in that shop's sales and inventory totals.

**One-line pitch:** “Less line, more market: order from a community stall by chatting, pay with PayPal, and let organizers keep service moving.”

**Core demo moment:** A visitor types “Two yakisoba and one iced tea.” Yatalk recognizes the products, confirms available stock, shows a receipt calculated by the server, and opens PayPal checkout. After sandbox approval, the visitor gets a pickup code; the organizer dashboard immediately reflects the sale and can answer “What is almost sold out?” with database-backed figures.

The fictional demo venue is **Little Harbor Market** in Tokyo. The seeded menu uses a small set of familiar market foods and drinks, with fictional prices, stock, and dietary notes.

The project targets the hackathon’s requirement to use both the PayPal developer platform and AI meaningfully, and its judging criteria for implementation, design, impact, innovation, and presentation. It is aimed at **Best Use of PayPal + AI** and **Best Use of Agentic Commerce**, without adding unrelated sponsor integrations.

## 2. Users and problem

### Visitors

Parents, neighbors, and other guests at a small event want to buy from a stall without waiting in a long line or figuring out a new ordering system. They may not know the menu name or exact combination they want. They can browse and use the chat without an account; payment always takes place in PayPal’s checkout UI.

### Organizers

Volunteer organizers need a fast way to see current orders, remaining stock, and sales while serving an event. They need a simple dashboard and concise answers backed by actual order data, not estimates invented by an AI model.

### Design principles

- A guest can understand and start an order without onboarding or an account.
- Chat is an optional, convenient way to form a cart; visible menu cards remain available.
- The visitor confirms the exact cart before checkout.
- Server data is authoritative for price, stock, order state, and sales.
- AI helps interpret requests and explain verified facts. It cannot create or capture a payment, issue a refund, or change stock directly.
- Demo data uses fictional products, people, and event names.

## 3. Scope

### MVP

1. English, responsive platform entry page and path-based shop storefronts with seeded fictional menu data.
2. Product cards with availability, price, and dietary notes.
3. AI chat that turns natural-language requests into validated cart changes and asks for clarification when needed.
4. Server-maintained cart, exact price calculation, stock check, and explicit order confirmation.
5. PayPal sandbox checkout: create order on the server, buyer approval in the PayPal JavaScript SDK, server capture, and a durable receipt with a pickup code.
6. Shop owner accounts, per-shop dashboards for live orders, sales, inventory editing, and collection; preserve the access-code login for the Little Harbor demo.
7. Organizer AI Q&A whose numeric facts are calculated in SQL before being explained in natural language.
8. Full refund of a paid, not-yet-collected order, initiated only by an authenticated organizer after an explicit confirmation; organizer chooses whether to return the items to stock.
9. Verified, idempotent PayPal webhooks for capture and refund updates.
10. Setup guide, sandbox configuration, OSS license, focused tests, and a three-minute-or-shorter demo plan.

### Deferred

- QR scanning at pickup (receipt shows a pickup code for the MVP; organizers can search or enter it).
- Verified owner email and password recovery, customer accounts, email/SMS, delivery, recurring billing, per-shop live merchant onboarding and settlement, and production payment processing.
- AG Grid and other sponsor products. A small order queue is clearer for the first release; sponsor integration would consume time without strengthening the core flow.
- Partial refunds, customer-requested refund workflows, and automatic refund recommendations.
- Automated expiration jobs. Expired reservations stop counting in availability at their expiry time and are normalized to `expired` by the next order mutation; a background worker is unnecessary for a single-process demo.

## 4. Product experience

### Platform and shop pages

- Platform entry page (`/`) links to shop creation, owner sign-in, and the Little Harbor sample shop.
- Shop creation (`/shops/new`) creates an owner account and the first shop. Owners can add shops at `/dashboard/shops/new`.
- The customer storefront (`/shops/:shopSlug`) contains the menu, voice/chat ordering, cart, and checkout. Successful checkout links to `/shops/:shopSlug/orders/:orderId`; the order stays bound to the shop visitor session.

### Customer storefront (`/shops/:shopSlug`)

- Header: Yatalk wordmark, shop name, “Open now” status, and an `Owner` link.
- Hero: “A little market. A lot less waiting.” One short line explaining chat ordering and PayPal checkout.
- Main workspace: centered page with a 72px header, short hero, and a 12-column content grid (menu 7 columns; chat and order summary 5 columns). The chat card sits above a sticky cart on desktop; on mobile, stack chat, cart, then the menu with no horizontal scrolling.
- Menu: item name, short description, price, dietary note when supplied, remaining availability, and an `Add` control. Out-of-stock items remain visible with a plain unavailable state.
- Chat: one example prompt (“Two yakisoba and one iced tea”), concise assistant replies, visible progress, and a persistent input. The chat does not claim that an item is allergen-safe when its notes are incomplete.
- Cart: item, quantity controls, server-returned line totals and total, stock warnings, `Clear cart`, and a `Confirm order` action. PayPal UI appears only after confirmation.
- Checkout: PayPal Smart Buttons loaded with the public sandbox client ID. A setup message replaces the checkout controls when required sandbox configuration is missing.
- Success: order number, pickup code, total, and order status. The pickup code is generated only when a verified PayPal capture moves the order to `paid`; it is never shown for pending, cancelled, or uncertain payments. No customer name, email, or payment details are collected by Yatalk.

### Shop owner sign-in (`/dashboard/login`)

Owners sign in by email and password, see their shops at `/dashboard/shops`, and open each shop dashboard at `/dashboard/shops/:shopSlug`. Each dashboard request checks both the owner session and membership for the resolved shop. The public slug never grants management access. Shop addresses are immutable in this prototype.

### Little Harbor demo sign-in (`/organizer`)

A single access-code form, explicit error state, and no registration or profile setup. Login is rate-limited. The code is checked on the server and is never returned to the browser.

### Shop operations dashboard (`/dashboard/shops/:shopSlug`; legacy `/dashboard`)

- Compact summary cards: paid sales today, paid order count, and low-stock items.
- Order queue with status filters, newest first, item summary, total, creation time, and pickup code. Organizers can mark paid orders as collected.
- Inventory table with item, price, on-hand, reserved, and available counts, dietary note, and a bounded physical-count editor.
- Refund control on eligible paid, not-yet-collected orders. A confirmation names the amount and asks whether the stock should be restored.
- AI operations box with example prompts such as “What is almost sold out?” and “Which item sold most?” The answer shows source figures from the database alongside the generated explanation.
- Clear loading, empty, saved, and error states. A failed AI request never blocks the order queue or inventory controls.

### Visual direction and shared tokens

Use a warm, editorial neighborhood-market feel: paper-like background, ink-green text, tomato-red primary action, and soft citrus accents. Keep the interface calm and legible; let the live cart and PayPal action carry the emphasis. Avoid stock photography and third-party marks in demo assets.

Define shared CSS tokens before styling screens: paper `#F7F4EC`, surface `#FFFEFA`, ink `#183331`, muted ink `#61736D`, tomato `#C74632`, citrus `#F3C969`, line `#E4E0D6`, success `#2D7665`, and error `#B64035`. Use white text on tomato buttons and ink text on citrus accents. Use system sans-serif for body text and a system serif for large headings; spacing steps are 4/8/12/16/24/32/48px, radii 8/14/24px, and elevation is limited to the cart/checkout surfaces. Reuse one shared button, form-control, status-pill, and card style. Body copy and controls are at least 16px where practical, keyboard focus is always visible, and interactive targets are at least 44px. Respect reduced motion and color contrast; status is never communicated by color alone. Acceptance includes at least 4.5:1 contrast for normal text, keyboard completion of chat/cart/dashboard actions, and a 360px-wide layout check.

## 5. User journeys and acceptance criteria

### A. Browse and form a cart

1. Visitor opens the event page and can see the menu without signing in.
2. Visitor adds a menu item directly or describes a request in chat.
3. The AI may ask a short clarifying question. It returns only product IDs and bounded cart operations; the server checks IDs, quantities, availability, and the current catalog.
4. The server persists the cart for the visitor’s anonymous session and returns authoritative item names, prices, stock, and total.

**Accept when:** An ambiguous product request asks for clarification; an unknown product does not create a line; a quantity above available stock is rejected with the available amount; and the displayed total equals the server’s sum of current catalog prices times quantities.

### B. Pay and collect

1. Visitor reviews the exact cart and chooses `Confirm order`.
2. On PayPal button activation, the server starts a short stock reservation and creates one PayPal sandbox order from the database cart.
3. Buyer approves using PayPal’s UI. Yatalk’s browser never handles card or PayPal credentials.
4. The server captures the matching PayPal order idempotently, verifies completed status, amount, and currency, then marks the local order paid. Stock was reserved atomically before PayPal checkout opened.
5. Success page shows the receipt and pickup code. The organizer sees the order in the queue and may mark it collected.

**Accept when:** Cancelling checkout does not mark the order paid and releases its reservation; duplicate create/capture requests do not create a second charge; an amount/currency mismatch is not marked paid; unavailable stock cannot be checked out; and only a paid order can be marked collected.

### C. Organize and answer a question

1. Organizer signs in with the configured access code.
2. Dashboard shows only database-backed orders, stock, and totals.
3. Organizer edits a bounded stock quantity or marks a paid order collected.
4. For an operations question, SQL computes the relevant totals first; AI writes a short explanation from only those values.

**Accept when:** Unauthenticated requests cannot access organizer routes; changing stock requires an authenticated, same-origin request; a query with no matching facts says there is no matching data; and the numbers shown with the AI answer match the dashboard.

Sales reporting shows gross captured sales and net captured sales (gross minus completed full refunds). Paid and collected orders count as captured sales; refunded orders are excluded from the net order count. Store timestamps in UTC and compute “today” using the event timezone, configured as `Asia/Tokyo` for the seeded market.

### D. Refund

1. Organizer chooses refund on a paid, not-yet-collected order and confirms the full amount.
2. Organizer explicitly chooses whether to restore the item quantities.
3. Server verifies the order and captured payment id, submits one idempotent PayPal refund, and records the result.

**Accept when:** Visitors and AI cannot issue refunds; collected/refunded/unpaid orders are rejected; a repeat request does not refund twice; and stock changes only when the organizer selected restoration.

## 6. Architecture

### Stack

- React + TypeScript + Vite + React Router for a responsive single-page UI and platform, shop, and owner routes.
- Node.js + TypeScript + Express for same-origin API routes and serving the built app.
- SQLite via `better-sqlite3` for a self-contained local demo and transactional stock updates.
- Zod for request and model-output schemas; Helmet and `express-rate-limit` for baseline headers and bounded public traffic.
- Gemini on Vertex AI with structured JSON output for visitor intent extraction and organizer answer phrasing. The project uses Application Default Credentials; no API key is stored in the application.
- Gemini audio input transcribes short voice orders to editable text. Users review the transcript before sending it to the cart interpreter.
- PayPal JavaScript SDK buttons in the browser and PayPal Orders v2 / Payments v2 REST calls from the server, always against sandbox credentials for the hackathon demo.

This includes path-based tenant isolation, but remains a prototype rather than a production marketplace. Local SQLite data lives under `.data/` and is ignored by Git. The current Cloud Run preview stores the database at `/tmp/yatalk/yatalk.sqlite`, which is temporary, and rate limits are process-local. A hosted multi-shop service needs durable shared storage and shared session/rate-limit state. Owner email verification and password recovery are not implemented, and every shop currently shares the demo PayPal Sandbox credentials.

### File structure

```text
src/
  app/                 Page-level layout and route views
  components/          Shared controls, menu, chat, cart, checkout, dashboard
  lib/                 API client, currency and view helpers
  styles/              Design tokens and global responsive styles
server/
  app.ts                Express setup, middleware, static build serving
  routes/              Public, tenant, management, organizer, and webhook routes
  services/            AI, PayPal, and order workflows
  database.ts            SQLite schema, migration, and sample seed data
  inventory.ts          Tenant-scoped product, cart, and stock queries
shared/
  schemas.ts           Shared request/response validation schemas
tests/
  unit/                Pricing, transitions, validation, and summary logic
  integration/         Route auth, idempotency, and webhook verification
docs/
  yatalk-spec.md       This product and implementation design
  store/               Only if store/submission materials are later needed
```

Keep each hand-written source/configuration file at 500 lines or fewer. Split routes and UI by cohesive responsibility.

## 7. Data model and order lifecycle

### Tables

- `shops`: immutable public slug, display name, status, currency, time zone, and tenant catalog revision.
- `users`, `owner_sessions`, and `shop_memberships`: password hash, hashed opaque owner-session token, expiry, and per-shop role.
- `products`: shop id, product id, `name`, `description`, `price_minor`, `currency`, `stock_on_hand`, `dietary_note`, `active`, `updated_at`.
- `visitor_sessions`: shop id, hashed opaque visitor token, integer cart version, expiry, creation time. No identifying customer fields.
- `shops.catalog_revision`: shop-scoped revision updated with price/product changes, stock transitions, and reservation creation/release. The legacy `app_meta` value is migrated to the sample shop.
- `cart_items`: shop id, session id, product id, quantity, updated time; unique session/product pair.
- `orders`: shop id, opaque id, session id, unique session-scoped client request key, persisted PayPal create/capture/refund request IDs, PayPal order/capture/refund IDs, state, currency, `total_minor`, pickup code, reservation expiry, `refund_restock_requested`, one-time `restock_applied_at`, timestamps.
- `order_items`: shop id, order id, product id, display-name snapshot, unit price snapshot, quantity.
- `webhook_events`: unique PayPal event id, type, processing result, received time.
- `admin_audit_log`: shop id, owner actor id where available, action, target order/product id, bounded metadata, timestamp; no secrets or payment instruments.

Every menu, cart, order, inventory, report, and management query is scoped by the internal shop id. PayPal webhooks locate the stored order by the verified provider identifiers before applying its state transition.

All prices are integer minor units. The seeded event uses JPY with integer yen amounts; the server rejects currency mismatches and computes all totals from product rows. PayPal lists JPY as a supported currency with zero decimal places; the setup guide must still have the developer set a compatible JPY receiving currency on the sandbox seller account and verify a completed capture. Order items snapshot the price and name at confirmation so later catalog edits do not rewrite a receipt.

**Inventory invariant:** `stock_on_hand` is the physical quantity remaining after completed sales. Available stock is derived as `stock_on_hand` minus quantities in unexpired order reservations (`creating_payment`, `pending_payment`, `create_unknown`) and all `capture_unknown` reservations. Creating a local pending order adds a reservation by inserting its item rows in the same SQLite transaction; it does not change physical stock. A successful PayPal capture changes the order to `paid` and subtracts those quantities from `stock_on_hand` in one transaction, so available stock stays constant. A definite create failure, cancellation, or expiry releases the reservation by moving the order out of a reserved state; physical stock is unchanged. Unknown capture outcomes keep their reservation indefinitely until the visitor retries or a verified webhook updates state. A completed organizer refund adds quantities back to `stock_on_hand` only when `restock=true`; `restock_applied_at` makes that adjustment one-time. Inventory edits set physical on-hand quantity and must not go below the currently reserved quantity; the dashboard shows on-hand, reserved, and available counts so releasing a reservation cannot surprise the organizer.

### State transitions

```text
cart -> creating_payment (reserve quantities; reservation expires in 10 minutes)
creating_payment -> pending_payment (PayPal order id saved)
creating_payment -> create_unknown (PayPal create response timed out; retry with the same request ID)
creating_payment -> create_failed (definite provider rejection; release reservation)
create_unknown -> pending_payment (same-key retry recovers PayPal order id)
pending_payment -> paid (verified PayPal capture; subtract stock_on_hand and release reservation atomically)
pending_payment -> cancelled / expired (release reservation)
pending_payment -> capture_unknown (retain stock until provider reconciliation)
capture_unknown -> paid (PayPal confirms capture; subtract stock_on_hand and release reservation atomically)
capture_unknown -> pending_payment (PayPal confirms no capture; keep reservation while retry remains valid)
create_unknown -> expired (after 10 minutes; no order id was exposed to the visitor)
paid -> collected
paid -> refund_unknown (retain state and stock until provider reconciliation)
paid -> refunded (organizer-approved full refund; restore stock only if selected)
refund_unknown -> paid (PayPal confirms refund did not complete)
refund_unknown -> refunded (PayPal confirms full refund)
```

An order cannot move backwards or skip a required state. Create, capture, and refund request IDs are persisted before their PayPal call and reused unchanged on retry. `POST /api/orders` also has a unique `(visitor_session_id, client_request_key)` constraint so browser retries return the same local order. Duplicate webhook event IDs are ignored after the first successful processing. A create timeout moves the order to `create_unknown`; an authenticated retry with the same key replays the saved PayPal create request and recovers its result. A capture timeout moves the order to `capture_unknown`; a refund timeout moves it to `refund_unknown`. Retries occur only through POST routes with the original request ID; GET routes only read stored state. A pending order with no approval can expire after 10 minutes; unknown capture/refund outcomes cannot expire automatically. Reservation counts are derived from active order states, so cancellation/expiry releases stock once by changing order state; capture and refund mutations use a state guard to avoid duplicate stock adjustments. Only `paid` orders may be collected or refunded; a collected order is final for this MVP. `refund_unknown` is displayed as “Refund checking” and remains counted as captured until PayPal confirms the result.

## 8. API contracts and access

All JSON routes cap body size and validate content type, field types, lengths, ranges, and unknown fields. JSON bodies are limited to 32 KB (PayPal webhook raw bodies to 64 KB). Public POST routes use a bounded IP/session rate limit and exact same-origin checks; no cross-origin clients are supported. Cookie-authenticated state changes additionally require a valid CSRF origin check. Responses contain generic errors and a correlation id, never provider credentials or stack traces.

The legacy `/api/*` endpoints continue to address Little Harbor. Multi-store customers use `/api/v1/shops/:shopSlug/*`; management uses `/api/v1/dashboard/shops/:shopSlug/*`. The server resolves the slug once and scopes all underlying reads and writes by the shop id. The path does not grant dashboard access.

| Route | Access | Purpose |
|---|---|---|
| `GET /api/config` | Public | Non-secret event, currency, and PayPal client configuration for the browser |
| `GET /api/menu` | Public | Active menu and available counts; no private session data |
| `GET /api/cart` | Visitor session | Current cart with server-computed prices, total, and versions |
| `POST /api/chat` | Visitor session | Bounded message/history/versions; AI response and validated cart updates |
| `POST /api/cart/items` | Visitor session | Direct add/update/remove with product ID, quantity, and versions |
| `DELETE /api/cart` | Visitor session | Clear all cart lines and return an empty versioned cart |
| `POST /api/orders` | Visitor session | Confirm cart, reserve stock, create PayPal order; server supplies amount |
| `GET /api/orders/:id` | Owning visitor session | Read stored receipt-safe order status only |
| `POST /api/orders/:id/capture` | Owning visitor session | Capture the bound PayPal order idempotently |
| `POST /api/orders/:id/cancel` | Owning visitor session | Release a still-pending reservation after checkout cancellation |
| `POST /api/organizer/session` | Public, rate-limited | Verify organizer access code and set signed HttpOnly cookie |
| `DELETE /api/organizer/session` | Organizer | End organizer session |
| `GET /api/organizer/summary` | Organizer | Orders, sales, and stock aggregate |
| `GET /api/organizer/orders/:id` | Organizer | Read stored order/refund status only |
| `PATCH /api/organizer/products/:id` | Organizer | Bounded price/physical stock/availability edit |
| `POST /api/organizer/orders/:id/collect` | Organizer | Mark eligible paid order collected |
| `POST /api/organizer/orders/:id/refund` | Organizer | Full refund with explicit `restock` choice |
| `POST /api/organizer/ask` | Organizer | AI explanation of SQL-computed metrics |
| `POST /api/webhooks/paypal` | PayPal | Verify signature, dedupe event, reconcile order state |
| `POST /api/v1/shops` | Public, same-origin, rate-limited | Create an owner account and first shop |
| `POST /api/v1/auth/session` | Public, same-origin, rate-limited | Verify owner credentials and set an HttpOnly session cookie |
| `GET /api/v1/auth/session` | Optional owner session | Return whether the owner is signed in |
| `DELETE /api/v1/auth/session` | Owner session, same-origin | Revoke the owner session |
| `GET /api/v1/dashboard/shops` | Owner session | List only shops where the owner is a member |
| `POST /api/v1/dashboard/shops` | Owner session, same-origin | Add a shop to the owner's account |
| `/api/v1/shops/:shopSlug/{config,menu,cart,chat,voice,orders}` | Visitor session where required | Shop-scoped customer config, menu, cart, AI, voice, and order operations |
| `/api/v1/dashboard/shops/:shopSlug/{summary,orders,products,ask}` | Owner session and shop membership | Shop-scoped operations and inventory |
| `POST /api/v1/webhooks/paypal` | PayPal | Versioned alias for the verified shared webhook handler |

### Key request/response rules

- `GET /api/config` returns `{ eventName, currency, paypalClientId, paypalEnabled }`. The client ID is public; secrets and provider tokens are never included. `paypalEnabled` is false when either sandbox credential is missing.
- `GET /api/menu` returns `{ event, products, catalogRevision }`; each product includes an opaque id, name, description, integer `priceMinor`, currency, dietary note, and computed available quantity. It returns no user/session data. Availability excludes expired reservations by timestamp without mutating the order; the next order POST normalizes expired states transactionally.
- `GET /api/cart` creates an anonymous visitor session when needed, sets its opaque token in an HttpOnly same-site cookie, and returns `{ items, totalMinor, currency, cartVersion, catalogRevision }`. The database stores only the token hash.
- `POST /api/chat` accepts `{ message, history, cartVersion, catalogRevision }`. `message` is at most 800 characters, `history` at most 8 role/content pairs of at most 800 characters each, and both versions must match. It returns `{ reply, clarification, cart }`, where `clarification` is a string or `null`; cart item labels, prices, availability, total, and new versions come from the server. Stale versions return `409 cart_changed`; invalid input returns `400`; rate limiting returns `429`; an AI outage returns `503` without changing the cart.
- Model output is strict Structured Outputs JSON with all fields required and no extra properties: `{ reply: string, clarification: string | null, operations: [{ action: "add" | "set" | "remove", productId: string, quantity: integer }] }`. Each nested object also has `additionalProperties: false`; quantity is bounded to `0..20` (`remove` requires `0`, `add`/`set` require `1..20`). The server separately checks product existence, active status, and available stock before applying operations. In the provider JSON Schema, nullable values use an explicit string-or-null union and every key remains required.
- `POST /api/cart/items` accepts `{ action, productId, quantity, cartVersion, catalogRevision }` with the same quantity limits. It returns the server cart and versions; stale versions return `409` plus the current cart.
- `DELETE /api/cart` requires the visitor session and exact same-origin check, deletes that session's cart lines, increments `cartVersion`, and returns the empty server cart. It does not alter inventory or any order reservation.
- `POST /api/orders` accepts `{ cartVersion, catalogRevision, clientRequestKey }`; versions are nonnegative integers and the key is a UUID. It reads the cart only from the visitor session, rejects empty carts, checks current stock and both versions, snapshots catalog prices, reserves stock, and creates one PayPal order. The browser never sends an amount or PayPal order ID. First success returns `201 { orderId, paypalOrderId, expiresAt, totalMinor, currency }`; a same-key retry returns the existing order or retries its saved PayPal create request if state is `create_unknown`; uncertain creation returns `202 { orderId, state: "create_unknown" }`; changed cart/catalog/stock returns `409` plus the current cart; a reused key with different versions returns `409 idempotency_conflict`; definite provider rejection releases the reservation and returns a generic error.
- `POST /api/orders/:id/capture` accepts an empty body. It resolves the PayPal order ID from the owned local order, checks provider order state and expected total/currency, then captures with the saved request ID. Success returns `{ orderId, state: "paid", totalMinor, currency, pickupCode }`; an uncertain provider result returns `202 { orderId, state: "capture_unknown" }`. No provider ID or amount is accepted from the browser.
- `GET /api/orders/:id` verifies session ownership and returns the stored `{ orderId, state, totalMinor, currency, pickupCode }` only. It does not call PayPal or trigger a payment operation. For `create_unknown`, the client retries `POST /api/orders` with its same local key; for `capture_unknown`, the visitor explicitly retries `POST /api/orders/:id/capture`. It never exposes payer details or provider payloads.
- `GET /api/organizer/summary` returns `{ metrics, orders, products }`; orders are newest-first and limited to 50. `metrics` is `{ grossSalesMinor, netSalesMinor, paidOrderCount, lowStockCount }`, using the event-local day and a low-stock threshold of 3 available units. Each order has `{ orderId, state, totalMinor, currency, pickupCode, createdAt, items: [{ name, quantity }] }`; `pickupCode` is present only for paid/collected orders. Product rows include `{ id, name, description, priceMinor, currency, dietaryNote, available, stockOnHand, reserved }`. No payer details are returned.
- `GET /api/organizer/orders/:id` returns sanitized stored order/refund state only and never calls PayPal.
- `PATCH /api/organizer/products/:id` accepts at least one of `{ name, description, priceMinor, stockOnHand, dietaryNote, active }`; fields are bounded and validated. `stockOnHand` cannot be set below current reservations. Success returns the updated product row and increments `catalogRevision`; invalid edits return `400`, reservation conflicts `409`.
- `POST /api/organizer/orders/:id/collect` accepts an empty body, transitions only `paid` to `collected`, and returns `{ state: "collected" }`; repeating completed collection is idempotent, other states return `409`.
- `POST /api/organizer/orders/:id/refund` accepts `{ restock: boolean }`; organizer auth and CSRF checks are required. Server only allows state `paid` (not collected) and one full refund, persists/reuses one refund request ID and the restock choice, and returns `200 { state: "refunded", restocked }` or `202 { state: "refund_unknown" }`. Invalid order state returns `409`; provider failure returns a retryable generic error. A safe explicit retry uses the persisted request ID and same restock choice, so it cannot create a second refund.
- `POST /api/organizer/ask` accepts `{ question }` up to 500 characters and returns `{ answer, sourceFacts }`. Facts are computed before model invocation and rendered alongside the answer; invalid input returns `400`, rate limit `429`, and AI outage `503` without affecting the dashboard.
- `POST /api/webhooks/paypal` uses the original request headers and raw body for PayPal verification, caps input at 64 KB, and processes only configured event types after verification. It returns `204` for a processed or already-recorded event, `400` for invalid signatures, and `500` for temporary processing failures so PayPal can retry.

`POST /api/organizer/session` accepts `{ accessCode }` up to 128 characters, checks the exact configured browser Origin, and returns `204` with a signed, expiring HttpOnly cookie; invalid credentials return generic `401`, rate limit `429`. `DELETE /api/organizer/session` clears the cookie and returns `204`. Login is limited to five attempts per IP per 15 minutes. Visitor sessions use a random opaque token; only a hash is stored. Menu is capped at 30 active products, a cart at 12 distinct lines, and quantity at 20 per line. Admin stock edits accept an on-hand count from `0..999` only when it is at least the reserved quantity; price is a positive integer yen amount. Chat is limited to 12 requests/minute/session and 30/minute/IP; organizer AI to 10/minute/session.

`GET /api/organizer/orders/:id` returns the stored sanitized order/refund state only. A visible organizer retry action repeats `POST /api/organizer/orders/:id/refund` with the persisted request ID and original restock choice when local state is `refund_unknown`. `GET /api/orders/:id` likewise reads stored state only; create/capture retries use their existing POST routes. GET routes never call PayPal create, capture, or refund operations.

Refund, capture, and stock changes are never exposed as AI tools. Each organizer route verifies the signed session and authorizes the specific operation. Public order IDs are high-entropy bearer identifiers and are also bound to the visitor session for capture, cancellation, and reconciliation. Cart mutations include an optimistic cart version so an in-flight AI reply cannot overwrite newer visitor changes.

## 9. AI behavior and boundaries

### Visitor assistant

- Input is the current visitor message, a short bounded chat history, current cart, and the active menu with availability and dietary notes.
- Output follows the strict schema above: short `reply`, nullable `clarification`, and bounded cart operations referencing product IDs. Every object key is required in the provider schema; optional concepts use explicit `null` values.
- Server validates every model-produced value and applies operations transactionally. If parsing, validation, or the AI request fails, the prior cart remains unchanged and the user gets a retry message.
- The model does not calculate, set, or approve a price. The server returns cart details and total separately, and the UI renders those values.
- AI never sees PayPal credentials, captures, refunds, private admin data, or full webhook payloads.
- Dietary/allergen answers use only organizer-entered notes. Missing or ambiguous notes result in a prompt to ask the stall organizer.

### Organizer assistant

- The server authenticates the organizer and computes aggregates with parameterized SQL.
- The model receives only those aggregate facts and the question. It cannot query arbitrary tables or mutate data.
- The UI displays the source figures next to the prose. An AI outage leaves all non-AI dashboard functions available.

Use a timeout, small output-token limit, bounded input, and a rate limit. Log UTC timestamp, correlation ID, named stage/outcome, and sanitized error class only. Never log user chat text, API keys, or payment payloads. The model and API key are configured in runtime environment variables.

## 10. PayPal and security design

- Client ID is public and used only by the PayPal JavaScript SDK. Client secret and Google Cloud credentials remain server-side and use Application Default Credentials.
- Server creates one `CAPTURE` Orders v2 purchase unit from validated database line-item snapshots, not client/model totals. It sets the local order ID as the reference/custom ID for reconciliation, and uses the fixed app currency.
- Buyer approval occurs in PayPal’s hosted UI. Server capture checks the returned order and capture state, bound local order, exact total, and currency before marking an order paid.
- Use persistent idempotency request IDs for PayPal order creation, capture, and refund. Use a session-scoped local order key for duplicate browser order creation. Reconcile uncertain provider outcomes through the order-status route before changing stock or order state; retry a provider mutation only with its original request ID.
- Verify webhook signatures through PayPal’s `verify-webhook-signature` endpoint using the configured webhook id and original headers/body. Process only configured `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` events; dedupe event IDs and validate the local order/reference and capture association. Apply stock restoration from the saved `refund_restock_requested` decision only after a completed refund. The PayPal Webhook Simulator's mock events do not pass postback signature verification; use simulator events only for handler rejection/parsing tests, and use a real sandbox capture/refund to verify the authenticated success path.
- Organizer access code is configured at runtime; signed, expiring, `HttpOnly`, `SameSite=Lax` cookies carry session state. In production, cookies are `Secure`. Login is rate-limited and comparison is constant-time.
- Require an exact configured origin for browser state changes. Do not enable wildcard CORS. Apply request-size limits, route-specific rate limits, parameterized SQL, and security headers.
- Restrict public AI requests by session and IP, bound message/history size, set provider timeouts, and return sanitized errors. No production payment mode is included.
- Never commit `.env`, credentials, sandbox secrets, SQLite files, or tokens. `.env.example` contains placeholders only.

## 11. Failure, loading, and recovery states

- AI not configured/unavailable: menu and manual cart still work; chat reports a brief retry path.
- Empty cart: show one clear menu action and an example chat request.
- Empty inventory: show sold-out items and offer the remaining items; do not silently substitute.
- Invalid/oversized input or rate limit: return a readable retry message and keep existing cart state.
- PayPal SDK/client config unavailable: show setup status; never imply a payment succeeded.
- Buyer cancels: retain cart, release or expire reservation, and allow another attempt.
- Order creation result is uncertain: retain the local request key and retry the same saved create operation; do not open a second checkout until the original result is recovered or safely expired.
- Provider timeout after approval/capture: show “checking payment” and retry/reconcile; do not claim failure or release reserved stock until state is known.
- Refund timeout: show “Refund checking,” keep the order treated as paid until PayPal confirms the refund, and let the authenticated organizer safely retry with the same request ID.
- Dashboard API failure: preserve entered form state and show retry; do not clear data on an unsuccessful save.
- Webhook duplicate: return success after recording/detecting the duplicate; invalid signature: reject without state change.

## 12. Verification plan

### Automated tests

- Unit: integer pricing, cart operation validation, stock reservation and release, allowed state transitions, summary queries, pickup code uniqueness.
- Integration: missing/invalid visitor and admin sessions, malformed/oversized JSON, wrong Origin, rate-limit response, idempotent create/capture/refund, rejected PayPal amount/currency mismatch, webhook signature failure and duplicate event.
- UI smoke: first visit, empty menu/cart, chat add and clarification, manual item add, checkout cancellation, payment success (sandbox), organizer login, stock edit, pickup, and refund.
- Accessibility: normal text contrast at least 4.5:1, keyboard-only completion of chat/cart/dashboard actions, visible focus, and responsive layout at 360px width.
- Run dependency and secret scanning before any eventual commit or release; do not commit if gitleaks reports a finding.

### Manual sandbox run

1. Start the app from a clean checkout with the README instructions.
2. Configure a sandbox seller to accept JPY (or convert incoming JPY automatically), and use a PayPal sandbox buyer to approve, cancel, and retry a sample order.
3. Confirm captured amount/currency and completed order state in both Yatalk and the PayPal sandbox. If the seller does not accept/convert the currency, PayPal may leave the payment pending for manual approval.
4. Exercise the signature-verified webhook success path using a real sandbox capture/refund and the configured public HTTPS callback. The simulator's mock events do not pass PayPal postback signature verification; use them only to test parsing/rejection and other handler behavior, not as proof of the authenticated success path.
5. Refund a separate captured order; verify database state and optional stock restoration.
6. Run the three-minute demo path and confirm all narration and on-screen copy are in English.

Do not claim end-to-end sandbox verification until real sandbox credentials are configured and the flow above passes.

## 13. Delivery sequence

1. Scaffold the small TypeScript app, design tokens, and fictional menu; confirm the responsive public screen renders.
2. Create the SQLite schema, seed data, visitor sessions, catalog/cart APIs, and server-side totals.
3. Implement AI intent parsing, schema validation, ambiguity and failure handling, then connect it to the chat UI.
4. Add organizer session, dashboard, product edits, order queue, pickup, and SQL-backed AI answers.
5. Implement PayPal sandbox order creation, approval, capture, reconciliation/idempotency, and receipt.
6. Add verified webhooks and organizer refunds with explicit restock choice.
7. Add focused tests, README, OSS license, and error/loading/accessibility polish.
8. Perform manual sandbox run, capture screenshots, and record an under-three-minute demo. The final Devpost submission is a separate user action.

## 14. Hackathon proof points

- **PayPal is central:** it is the payment approval and capture path for every completed checkout, not a logo or optional side feature.
- **AI is meaningful:** it interprets open-ended purchase requests into validated cart changes and helps an organizer reason about live operations.
- **Human control remains:** customers review exact items and totals before the PayPal UI; organizers explicitly approve refunds and stock restoration.
- **Working project:** judges can run the source using the documented sandbox configuration or access a hosted demo if one is arranged later.
- **Submission readiness:** public repository with visible OSS license, setup and test instructions, English text, and a functioning demo video under three minutes.

## 15. Official references

- [PayPal AI Hackathon overview and requirements](https://paypalaihackathon.devpost.com/)
- [PayPal AI Hackathon official rules](https://paypalaihackathon.devpost.com/rules)
- [PayPal Standard Checkout integration](https://developer.paypal.com/studio/checkout/standard/integrate)
- [PayPal Orders API v2](https://developer.paypal.com/api/orders/v2/)
- [PayPal webhooks overview](https://developer.paypal.com/api/rest/webhooks/)
- [PayPal webhook integration and verification](https://developer.paypal.com/api/rest/webhooks/rest/)
- [PayPal webhook troubleshooting](https://developer.paypal.com/invoicing/troubleshooting)
- [PayPal REST idempotency and request IDs](https://developer.paypal.com/api/rest/requests/)
- [PayPal supported currencies](https://developer.paypal.com/api/codes/currency/)
- [PayPal security guidelines](https://developer.paypal.com/security-guidelines)
- [Google Cloud: Gemini structured output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)
- [Google Cloud: Gemini audio understanding](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/audio-understanding)

## 16. Review record

Independent design review: completed before implementation. Major findings on inventory, idempotency/reconciliation, webhook verification tests, and API contracts were addressed. Re-review confirmed GET routes are read-only and reservation accounting is consistent; the final clear-cart route and paid-only pickup-code rules are also reflected. The implementation follows this reviewed design.
