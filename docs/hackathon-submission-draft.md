# PayPal AI Hackathon submission draft

## Project title

**Yatalk — Voice Ordering for Neighborhood Stalls**

## One-line pitch

Turn a stall’s menu photo into a QR storefront where customers can order by voice or chat and pay with PayPal.

## Project description

Small market stalls often take orders from handwritten or printed menus while serving a queue. Setting up an online catalog takes time, and customers still have to wait to place an order.

Yatalk helps a stall owner create a simple storefront in minutes. The owner uploads a menu photo and reviews AI-suggested items, or adds products manually. Yatalk creates a QR code for the shop. A customer scans it, asks for items by voice or chat, reviews the recognized request and cart total, and checks out with PayPal Sandbox. The shop dashboard shows incoming orders and current availability.

AI assists with menu extraction, voice transcription, natural-language cart changes, and questions about live shop operations. People remain in control: owners review menu suggestions and set stock, customers review the transcript and cart, and the server validates prices and payment state.

## Tools and integrations

- **PayPal Developer Platform:** PayPal Sandbox checkout for the customer order flow.
- **Google Gemini through Vertex AI:** structured menu suggestions from a photo, short voice transcription, interpretation of order text, and answers grounded in shop data.
- **Web application:** QR-linked storefront and a separate owner dashboard for menus, stock, and orders.

## Hackathon fit and positioning

The project fits the core PayPal + AI requirement: AI turns a photo or customer request into a reviewed order, while PayPal Sandbox completes the purchase. It offers a concrete audience (small market stalls) and a full product flow instead of a standalone model demo. The repository history shows substantial work during the submission period, including shop setup, checkout recovery, menu-photo OCR, QR sharing, and live OCR verification; mention this if describing how the project evolved during the event.

The official judging criteria give equal weight to implementation, design, impact, innovation, and presentation. The demo should therefore show both the technical flow and the shop/customer benefit. The event also lists “Best Use of Agentic Commerce” as a prize category. Yatalk is adjacent to that idea because AI interprets a spoken intent into a cart, but the buyer reviews and confirms it; describe it as human-approved AI commerce rather than an autonomous purchasing agent.

## Demo video outline (target: 2:40)

| Time | Show | Narration |
| --- | --- | --- |
| 0:00–0:15 | Busy stall menu and Yatalk landing page | “A small stall can have great food and still lose time taking every order by hand.” |
| 0:15–0:50 | Create a shop, upload the test menu photo, inspect AI suggestions | “The owner starts from a menu photo. Yatalk drafts the items; the owner checks names and prices before saving.” |
| 0:50–1:05 | Set stock, publish, show the shop QR | “Set today’s availability and share the QR code.” |
| 1:05–1:35 | Open the shop as a customer and make a short voice order | “A customer scans the code and says what they want. The transcript stays editable.” |
| 1:35–1:55 | Show interpreted cart, edit if needed, confirm server total | “Yatalk turns the request into menu items. The customer confirms the cart and total.” |
| 1:55–2:20 | Complete PayPal Sandbox checkout | “PayPal handles checkout; Yatalk never handles card details.” |
| 2:20–2:40 | Show pickup code and shop dashboard order/stock | “The customer gets a pickup code, and the stall sees the order and updated availability.” |

Record the working web app in a browser, with readable screens and no unrelated tabs or personal information visible. Keep the finished YouTube video public and under three minutes. Use no unlicensed music or third-party marks beyond what the working product itself needs to demonstrate.

## Current release verification (2026-11-10 JST)

- Hosted preview: https://yatalk.kumagaias.com
- Current Cloud Run revision: `yatalk-dev-preview-00014-8rx`, using Firestore Standard in Tokyo.
- Build passed; all 81 unit and integration tests passed with the Firestore Emulator, including owner/shop setup, menu/cart, payment state, refund/restock, webhook replay, and concurrent stock reservation.
- Live read-only smoke checks passed: health, seeded menu (six products), and storefront page all returned HTTP 200. Production dependency audit reported zero vulnerabilities.
- The current revision has **not** completed a buyer-approved PayPal Sandbox purchase. The automated suite uses a fake PayPal provider for payment transitions. The owner account and custom shop from the previous temporary SQLite preview were not migrated; create a fresh owner account for the demo.
- Still verify on the hosted revision before recording: fresh owner registration, menu photo OCR and manual correction, shop QR, voice transcript review, buyer cart, Sandbox checkout, and the resulting order in the owner dashboard. A buyer must perform the final PayPal purchase confirmation.

## Submission checklist

- [ ] Verify the complete flow on the current hosted preview: menu photo → owner review → QR → voice or chat order → PayPal Sandbox approval/capture → receipt → shop order view.
- [ ] If the current revision has a checkout or webhook issue, fix and verify it before recording; do not rely on an earlier revision’s payment run.
- [ ] Record and publish the demo video on YouTube; add its public URL to Devpost.
- [ ] Add the hosted demo URL and explain how judges can create a shop and test the flow without private credentials.
- [ ] Add this project description, tool list, public source repository, and screenshots to Devpost.
- [ ] Confirm the public GitHub repository visibly shows the MIT license and includes setup/run instructions.
- [ ] State clearly that all shops use the app’s shared PayPal Sandbox seller; per-shop payout accounts and live payments are not part of this prototype.
- [ ] Submit before **Nov 12, 2026, 12:00 PM PST** (**Nov 13, 2026, 5:00 AM Japan Standard Time**), as listed on the [official hackathon page](https://paypalaihackathon.devpost.com/).

## Prototype scope to disclose

Yatalk is a hackathon prototype. PayPal payments use Sandbox, and payments go to one app-configured Sandbox seller. Per-shop PayPal onboarding, settlement, and live payments are not implemented. Menu-photo results are suggestions that require owner review; AI does not set stock, publish products, or capture payments.

## Official requirements

- [Hackathon overview and submission requirements](https://paypalaihackathon.devpost.com/)
- [Official rules and judging criteria](https://paypalaihackathon.devpost.com/rules)
