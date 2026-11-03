# Yatalk URL Design

**Status:** Implemented as a path-based multi-store prototype. Store paths share the current origin, `https://yatalk.kumagaias.com`.

## Browser URLs

| URL | Purpose |
|---|---|
| `/` | Yatalk entry page and links for shop owners and customers |
| `/shops/new` | Create the first owner account and shop |
| `/shops/:shopSlug` | Customer storefront, voice/chat ordering, cart, and checkout |
| `/shops/:shopSlug/orders/:orderId` | Order status for the browser session that placed it |
| `/dashboard/login` | Shop owner sign-in |
| `/dashboard/shops` | List the signed-in owner's shops |
| `/dashboard/shops/new` | Add another shop to that owner account |
| `/dashboard/shops/:shopSlug` | Shop-specific orders, inventory, collection, refunds, and operations assistant |
| `/organizer`, `/dashboard` | Compatibility screens for the original Little Harbor demo |

Example customer link:

```text
https://yatalk.kumagaias.com/shops/omise-example
```

The app creates a receipt link after a successful payment. The order remains protected by the shop-specific visitor session cookie, so a URL alone does not expose an order or pickup code on another browser.

## API URLs

Public shop requests are scoped by the slug in the URL:

```text
/api/v1/shops/:shopSlug/config
/api/v1/shops/:shopSlug/menu
/api/v1/shops/:shopSlug/cart
/api/v1/shops/:shopSlug/chat
/api/v1/shops/:shopSlug/voice/transcribe
/api/v1/shops/:shopSlug/orders/:orderId
```

The public API also supports cart mutations, order creation, capture, and cancellation beneath that shop path. Owner operations are under `/api/v1/dashboard/shops/:shopSlug/`. Owner sessions use `POST`, `GET`, and `DELETE /api/v1/auth/session`; the owner shop list and add-shop endpoints are `GET` and `POST /api/v1/dashboard/shops`. `POST /api/v1/shops` creates the initial owner account and first shop.

PayPal webhooks keep the configured `/api/webhooks/paypal` address. `/api/v1/webhooks/paypal` is also available as an alias. Webhook processing resolves the shop through the verified event and the stored PayPal-to-order association.

## Tenant and access rules

- Resolve each active `shopSlug` to an internal `shopId`; use `shopId` to scope products, visitor sessions, carts, orders, inventory, reports, and mutations.
- A slug is a public locator only. Every dashboard request requires a valid owner session and membership in the resolved shop.
- Keep visitor carts separate per shop in the same browser with shop-specific cookies.
- Require the exact configured browser `Origin` for state-changing browser requests. These path-based stores stay on one origin; wildcard CORS is not used.
- Slugs are lowercase ASCII letters and digits with single hyphens, 3–40 characters. They are unique and immutable after creation. `/new` is reserved for the create-shop routes.
- New shops start with copies of the sample menu and stock. Owners can adjust products, prices, and stock from the shop dashboard.

## Scope and rollout

Path-based tenants are enough for the hackathon demo: no per-shop DNS or load balancer is needed. A demo can show the owner creating two shops and then switching between their customer URLs and independent dashboards.

This is still a prototype. Local SQLite persists in `.data/`, but the current Cloud Run preview points `DATABASE_PATH` at `/tmp/yatalk/yatalk.sqlite`; that filesystem is temporary, so accounts, shops, and orders are not durable across instance restarts or revision changes. Rate limits are also process-local. Before real shops use this service, move tenant data to durable shared storage and use shared session/rate-limit state.

Owner email is not verified and password recovery is not implemented. All shops also share the demo's PayPal Sandbox integration; separate merchant onboarding, settlement, and live payments are not implemented. Keep this feature at prototype scope for the hackathon and do not treat it as a production marketplace.
