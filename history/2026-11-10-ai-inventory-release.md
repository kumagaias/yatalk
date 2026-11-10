# AI inventory and release continuation — 2026-11-10

## Goal

Continue Yatalk's AI-first market flow, with owner menu setup, buyer voice ordering, PayPal Sandbox checkout, and low-cost persistent shop data; add useful AI-assisted inventory guidance.

## Decisions

- Keep SQLite for local development and use the existing Firestore Standard/Terraform path for the hosted preview.
- Use seven local calendar days of paid sales to rank restock candidates. Compute a two-day target with a five-unit minimum on the server; Gemini explains and prioritizes candidates but cannot edit stock.
- Require an owner to confirm that stock physically arrived before incrementing inventory. Store receipt IDs transactionally so retries do not apply the same receipt twice.
- Shop QR codes open the storefront; customers build/review an order and pay through PayPal Sandbox. They are not PayPal-generated direct-payment QR codes.

## Changes

- Added AI-assisted restock priorities with available units, recent sales, days of cover, suggested quantity, and a review/receive action.
- Added English and Japanese inventory-intent matching so stock and sales questions load the seven-day sales window only when needed.
- Set owner signup throttling to ten attempts per IP per hour; the eleventh attempt is rejected, including attempts with invalid form data.
- Continued owner registration/reset protection, OCR and manual menu setup, shop images, path-addressed shops, voice-order resilience, and Firestore persistence from the existing worktree.

## Checks

- `npm run build` passed.
- `npm test` passed: 94 passed, 0 failed, 2 Firestore Emulator tests skipped because no emulator was configured.
- Registration throttling integration coverage confirms ten attempts pass the limiter and the eleventh receives HTTP 429.
- `terraform fmt -check -recursive infra/environments/prd` passed.
- Gitleaks found no leaks; changed hand-written source/config files are all at or below 500 lines.

## Next steps

- The current worktree changes are not deployed. Google Cloud Run reports authentication required; `gcloud` and 1Password are not signed in. After authentication is restored, build the image with Cloud Build, update the digest in `prd.auto.tfvars`, apply Terraform, and verify the hosted owner, OCR, voice, checkout, and Firestore flows.
- Run the two Firestore Emulator integration tests before the next release.
- Complete a buyer-approved PayPal Sandbox purchase on the hosted revision; automated tests use a fake PayPal provider.
