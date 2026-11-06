# Automatically generated shop address

- Goal: make the shop URL follow the shop name and keep the address non-editable.
- Changes: derive the URL slug directly from the shop name and render the shop address as a read-only output. Keep debounced availability feedback and server-side uniqueness validation.
- Checks: 69 tests passed; production build passed; isolated headless Chrome confirmed `Test Harbor` produces `test-harbor`, the address has no editable input, and availability feedback appears.
- Next: build and scan the committed image, then update the preview through Terraform and verify the shop setup page.
