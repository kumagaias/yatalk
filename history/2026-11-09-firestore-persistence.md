# Firestore persistence

## Goal

Keep Yatalk shop, owner, menu, cart, and order data across Cloud Run restarts while keeping recurring storage costs low.

## Decisions

- Use Firestore Standard's default database in `asia-northeast1`; keep SQLite for local development and tests.
- Manage the database, indexes, TTL policies, and least-privilege runtime access through Terraform.
- Document the free quota, billable TTL deletes, and the existing alerts-only budget.
- Do not switch the live service until the old temporary SQLite data has been preserved or explicitly reset.

## Changes

- Added a Firestore-backed persistence path for shops, owners, sessions, inventory, carts, orders, payment state, refunds, and analytics.
- Added Firestore Emulator integration coverage for checkout, webhooks, refunds, restart persistence, and concurrent stock reservations.
- Updated Cloud Run Terraform to select Firestore and wait for required permissions and indexes.
- Updated README cost and persistence notes.

## Checks

- `npm run build` passed.
- Firestore Emulator full suite passed 81/81 in the earlier verification run. The commit hook passed 79 tests and skipped the 2 emulator tests because it did not set `FIRESTORE_EMULATOR_HOST`.
- Terraform formatting and validation passed.
- Gitleaks found no secrets in the working tree or staged changes.

## Next steps

- Obtain authenticated Google Cloud access, run a reviewed Terraform plan, preserve or resolve the current preview SQLite shop/account data, then apply and deploy.
- Verify the live shop, owner login, catalog, and order persistence after deployment.
