# Merge: AI-first market workflow

- Goal: merge `feat/ai-first-market-workflow` into `main` for the public hackathon repository.
- Decision: preserve the complete voice-first ordering, PayPal Sandbox, Gemini, and AG Studio workflow from the feature branch.
- Checks: `gitleaks git --redact --no-banner` found no leaks; `npm test` passed (120 passed, 0 failed, 2 skipped).
- Next step: push `main`, then make the GitHub repository public when approved.
