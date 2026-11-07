# Menu OCR and QR ordering

- Goal: let shop owners set up menus from photos or manual entries and let buyers reach voice/chat ordering and PayPal checkout through a shop QR code.
- Decisions: new shops start with an empty menu; OCR returns editable suggestions and the owner sets price and stock before publishing. The QR opens the shop page. The demo uses one shared PayPal Sandbox seller account; owners sign in to Yatalk, with no per-shop PayPal onboarding.
- Changes: added bounded, authenticated menu-photo extraction and bulk product creation; added dashboard menu setup and QR sharing; clarified existing buyer voice transcription and checkout; updated setup and security documentation.
- Checks: `npm run build` passed; `npm test` passed (74/74), including the pre-commit hook; `npm audit --audit-level=high` found zero vulnerabilities; `gitleaks detect --redact` found no leaks; `git diff --check` passed.
- Source commit: `6c58249` (`feat: add menu photo setup and shop QR`).
- Release build: Cloud Build `df7eb911-9343-408e-bb90-52e04f3d0291` built source commit `1e36b25514ffff01bcd56ee395b052deadfcc9f1` as `sha256:5ee7e8f24b6698d1bd2b351e3128a229c386112dce74b49e4ab006b085ee7e79`. Artifact Analysis discovery finished successfully; it reported no package vulnerability occurrences.
- Deployment: Terraform 1.17.1 applied the digest through `infra/environments/prd`; plan/apply delta was 0 added, 1 changed, 0 destroyed, with only the existing Cloud Run image updated. Ready revision `yatalk-dev-preview-00013-x9q` serves the scanned digest.
- Hosted smoke checks: `/`, `/api/health` (`{"ok":true}`), `/shops/new`, `/shops/little-harbor-market`, and `/dashboard/login` returned HTTP 200. The deployed bundle contains menu photo setup, shop QR, and voice-order UI copy.
- Live OCR verification: ImageGen created `tests/fixtures/menu-ocr-test.png` (2.6 MB PNG). The owner-authenticated preview endpoint returned HTTP 200 and extracted Grilled Onigiri ¥400 with “Contains soy”, Iced Tea ¥300, and Mikan Jelly ¥500. A temporary empty test shop was created for the request; no product was saved or published and no PayPal payment was made.
- Updated the integration coverage to use the generated PNG fixture for upload validation, reviewed product creation, and publication checks.
