# Menu OCR and QR ordering

- Goal: let shop owners set up menus from photos or manual entries and let buyers reach voice/chat ordering and PayPal checkout through a shop QR code.
- Decisions: new shops start with an empty menu; OCR returns editable suggestions and the owner sets price and stock before publishing. The QR opens the shop page. The demo uses one shared PayPal Sandbox seller account; owners sign in to Yatalk, with no per-shop PayPal onboarding.
- Changes: added bounded, authenticated menu-photo extraction and bulk product creation; added dashboard menu setup and QR sharing; clarified existing buyer voice transcription and checkout; updated setup and security documentation.
- Checks: `npm run build` passed; `npm test` passed (74/74), including the pre-commit hook; `npm audit --audit-level=high` found zero vulnerabilities; `gitleaks detect --redact` found no leaks; `git diff --check` passed.
- Source commit: `6c58249` (`feat: add menu photo setup and shop QR`).
- Next steps: commit the feature branch, merge and push `main`, then deploy the verified main commit and smoke-check the hosted preview.
