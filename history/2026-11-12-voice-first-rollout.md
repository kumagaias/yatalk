# Voice-first ordering rollout

## Goal

Ship the voice-first PayPal ordering flow, make its English voice/chat responses follow the browser language, and finish the owner-facing counter and safety controls.

## Decisions

- The counter QR now opens the storefront with `?counter=1`.
- Voice/cart replies use the browser language and the supplied menu context; the analytics assistant retries one transient Gemini failure.
- Shop deletion is protected by exact shop-name confirmation. It disables the storefront and removes dashboard membership while retaining payment records for audit purposes.
- The Firestore counter-payment index is deployed.

## Changes

- Added customer voice flow copy, browser-language speech output, PayPal path improvements, sample-menu preview, favicon, and analytics tool-call signature handling.
- Added a shop-owner Danger zone, confirmed deletion endpoint, QR counter link, and separated sign-in recovery links.
- Updated the preview Cloud Run image configuration.
- Expanded the public README with PayPal, Gemini, AG Studio, and Resend setup details; MIT license is already included at the repository root.
- Accepted AG Studio 3.1 conversation metadata and longer tool histories, and moved the confirmed shop-delete control to the bottom of the individual shop dashboard.
- Locked cart and voice mutations as soon as a PayPal checkout is active, so the paid order snapshot cannot diverge from the visible cart. AG Studio now retains Vertex AI tool thought signatures across its browser tool-result turn, allowing the model to generate the report instead of stopping after delegation.
- The browser adapter also restores retained thought signatures into AG Studio's rebuilt conversation history before each follow-up request, avoiding reliance on Cloud Run instance affinity.

## Checks

- `make test` passed: 106 passed, 2 skipped.
- Targeted tenant and Gemini tests passed.
- Production build passed.
- Gitleaks staged scan passed.
- Cloud Run revision `yatalk-dev-preview-00026-r9r` passed `/api/health` with the AG Studio compatibility, checkout lock, and browser-to-server tool-signature fixes.
- Focused Gemini tests and the production build passed for the checkout lock and AG Studio fallback.

## Next steps

- Configure a verified Resend sender and API key before enabling password-reset and verification email delivery.
