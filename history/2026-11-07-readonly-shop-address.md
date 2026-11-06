# Automatically generated shop address

- Goal: make the shop URL follow the shop name and keep the address non-editable.
- Changes: derive the URL slug directly from the shop name and render the shop address as a read-only output. Keep debounced availability feedback and server-side uniqueness validation.
- Checks: 69 tests passed; production build passed; isolated headless Chrome confirmed `Test Harbor` produces `test-harbor`, the address has no editable input, and availability feedback appears.
- Release: source commit `51bae9f` built in Cloud Build `132afb50-0a28-4c54-aa59-077ffbad7292`. Artifact Analysis finished successfully with zero package vulnerability findings for image `sha256:cb9c26e83e125fea9db98ad00b858e652c73df0c2b2d3e06af9d32fc861dd2f2`.
- Deployment: the saved Terraform plan changed only the Cloud Run image (0 added, 1 changed, 0 destroyed). Ready revision `yatalk-dev-preview-00012-xj2` uses that exact digest. Public `/`, `/shops/new`, and `/api/health` returned HTTP 200; health returned `ok=true`, and the served JavaScript contained the new automatic-address copy.
- Next: the preview remains on temporary local SQLite storage; no PayPal purchase was performed for this UI rollout.
