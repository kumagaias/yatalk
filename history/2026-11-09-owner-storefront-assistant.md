# Owner storefront and menu assistant

- Goal: finish owner registration, owner/shop storefront paths, owner-default currency, and AI-assisted menu setup.
- Decisions: shops inherit the owner's selected currency; AI/OCR results remain editable drafts and require owner review before saving. Legacy dashboard routes remain supported when a shop slug is unambiguous.
- Changes: added owner identity and shop ownership persistence, nested public/dashboard APIs, currency-aware prices and PayPal amounts, a right-side menu assistant, and owner-scoped QR/storefront links. Fixed dashboard route precedence and empty-shop product creation.
- Checks: build passed; 79 unit and integration tests passed; Gitleaks found no leaks; npm audit found 0 vulnerabilities; `git diff --check` passed.
- Deployment: not applied. Preview revision `yatalk-dev-preview-00013-x9q` is still serving the prior owner/shop paths. Cloud Run's SQLite file is under `/tmp` and may be lost on a revision change.
- Next: choose durable storage or accept the preview data reset risk before deploying this revision.
