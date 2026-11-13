# Dashboard lifecycle and sales-window boundary

- Goal: create blank dashboards, delete individual saved dashboards, and investigate intermittent restock-test failures.
- The seven-day sales window excluded captures at exactly the request millisecond. A fixed-time SQLite reproduction failed before the fix; the exclusive upper bound now advances one millisecond for both SQLite and Firestore queries.
- New dashboards start empty with distinct names. Owners can confirm deletion of the selected browser-local dashboard; deleting the last creates an empty fallback. Preset updates and outgoing report state are explicitly saved when switching dashboards.
- Checks: fixed-time boundary and dashboard-library tests, full suite (126 passed, 2 skipped), production build, and isolated headless Chrome with mocked shop data covering overview generation, blank creation, reload, deletion and restoration.
- Deployed Cloud Run revision `yatalk-dev-preview-00042-dgk`; readiness and `/api/health` passed. Firestore emulator integration tests were skipped because the emulator was not available.
