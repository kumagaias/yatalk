# PayPal capture verification and AI stock review — 2026-11-10

## Goal

Continue Yatalk checkout verification and confirm the existing AI-assisted inventory workflow.

## Decisions

- PayPal `reference_id` and `custom_id` may be omitted; accept missing values and PayPal's default `reference_id`, while rejecting conflicting values.
- Keep order ID, amount, currency, completed order, and completed capture verification strict.
- AI inventory guidance already exists: seven-day sales and current availability feed server-calculated restock candidates, with owner-confirmed receipt before stock changes.

## Changes

- Apply the same optional-reference checks to both pre-capture status verification and capture verification.
- Add integration coverage for omitted and conflicting PayPal references.
- Leave the separate hackathon submission draft untracked because its hosted-revision claim is still unverified.

## Checks

- `npm run build` passed.
- Full `npm test` passed: 95 passed, 0 failed, 2 Firestore Emulator tests skipped.
- Focused PayPal and AI inventory tests passed: 15 passed.
- Gitleaks found no leaks; `git diff --check` passed. Hand-written changed source/test files remain under 500 lines.

## Next steps

- Push the verified fix to `main` as previously requested.
- Verify deployment and hosted checkout after Google Cloud authentication is restored.
- Run Firestore Emulator tests when Java 21+ is available.
