# Yatalk checkout and shop setup

- Goal: finish the Sandbox checkout recovery and make shop URLs derive from the shop name with live availability feedback.
- Decisions: use `op run --env-file .env` for runtime credentials; keep the paid receipt in session storage across PayPal's return navigation; preserve explicit versioned API paths and validate slug availability on the server.
- Changes: read PayPal `custom_id` from the capture when it is absent on the purchase unit; add safe boolean capture-verification logs; preserve paid checkout state; add shop slug generation and rate-limited availability checks with regression tests.
- Checks: 67 tests passed; production build passed; a completed Sandbox checkout captured and matched order, reference, amount, and currency; a headless local smoke confirmed the receipt and pickup code survive return and reload; staged Gitleaks found no leaks.
- Next: deploy through Cloud Build and Terraform after an authenticated Google Cloud user is available. No secret values or `.env` files are committed.
