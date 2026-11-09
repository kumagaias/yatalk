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

## Cloud preparation

- Firestore API, default database in `asia-northeast1`, four indexes, three TTL policies, and `roles/datastore.user` were applied with a database-only plan: 10 added, 0 changed, 0 destroyed. Cloud Run remained on SQLite.
- Cloud Build `ae758e29-efb6-4158-aef5-cd74d9d3918a` succeeded for commit `51cff86`; the image digest is pinned in `prd.auto.tfvars`.
- The final Terraform plan was 0 added, 1 Cloud Run update, 0 destroyed. It switched from `/tmp/yatalk/yatalk.sqlite` to Firestore and deployed the digest-pinned image.

## Deployment

- Cloud Run revision `yatalk-dev-preview-00014-8rx` now receives 100% traffic with `DATABASE_BACKEND=firestore` and image digest `sha256:8f18df1e809e4f95536e9982b528c8f6ee6f326930d2cd05e6e911f6fcf0cc6c`.
- Live checks passed: `/api/health` returned 200 and `/api/menu` returned 200 with six seeded products. A final Terraform plan reported no changes.
- The old temporary SQLite records were not imported. The public test-shop menu returned 404 at cutover, so there was no public menu to migrate. Any owner login held only in SQLite may need to be recreated.

## Next steps

- Owners should sign up again if their old preview login is no longer recognized. Complete a live PayPal Sandbox buyer checkout when those credentials are available.
