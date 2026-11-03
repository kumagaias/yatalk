# Yatalk demo captures and verification

Captured from the public development preview on 2026-11-02 with isolated headless Chromium. The desktop image and walkthrough use a 1280px viewport, and the mobile images use a 360px viewport. The market captures show the empty-cart landing state; the organizer capture shows the login form without attempting a login.

- [Desktop market page](./yatalk-desktop-2026-11-02.png)
- [360px market page](./yatalk-mobile-360px-2026-11-02.png)
- [360px organizer login](./yatalk-organizer-login-360px-2026-11-02.png)
- [17-second market and checkout walkthrough](./yatalk-walkthrough-2026-11-02.webm)

The preview loaded six menu items and PayPal Sandbox configuration. A synthetic chat order was interpreted and added two menu items; the test cart was then cleared. A synthetic speech sample was recorded through Chromium's fake microphone, transcribed, and left in the editable input without changing the cart. The organizer login form loaded at 360px. The market UI had no horizontal overflow at 1280px or 360px; all visible buttons had accessible names; keyboard focus was visible; the landing page's 85 visible text elements met the 4.5:1 normal-text / 3:1 large-text contrast thresholds.

Local verification on the `.env`-free copy: 51 tests passed and the production build passed. `npm audit` found 0 vulnerabilities, and Gitleaks found no leaks. Regression coverage includes the PayPal refund event shape (`invoice_id`, `custom_id`, and the `links.up` capture reference), replay and conflicting-reference checks, status/amount/currency validation, non-empty refund IDs, capture-ID mismatch rejection, and sanitized error logging. The fix is deployed to Cloud Run revision `yatalk-dev-preview-00008-zxb` on digest `sha256:9471254ebab0e0366dac0512e7372e077d96ba0cdf9704a71f9d3095e397237f`; a headless HTTP check returned 200. Artifact Analysis completed for the exact digest and reported zero vulnerability occurrences.

One JPY 300 PayPal Sandbox order was buyer-approved, captured, and fully refunded. PayPal delivered signed capture and refund events, and both webhook requests received HTTP 204. The capture event moved the local order to `paid`. The refund event exposed a reconciliation bug: PayPal supplies the local order reference and capture link rather than `related_ids.capture_id`; the prior handler acknowledged it but left the order in `refund_unknown`. That mapping is fixed, covered by regression tests, and deployed. The walkthrough records synthetic voice transcription, chat ordering, and a ¥300 Sandbox checkout reservation that was cancelled before buyer approval; no payment was captured during recording. A fresh signed refund event on the patched revision remains to be verified after buyer approval.
