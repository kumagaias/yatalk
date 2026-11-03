.PHONY: test

REPO_ROOT := $(CURDIR)

test:
	@set -eu; \
	repo_root="$(REPO_ROOT)"; \
	tmpdir=$$(mktemp -d); \
	trap 'rm -rf "$$tmpdir"' EXIT; \
	cd "$$tmpdir"; \
	node --import "$$repo_root/node_modules/tsx/dist/loader.mjs" --test --test-concurrency=1 "$$repo_root"/tests/unit/*.test.ts "$$repo_root"/tests/integration/*.test.ts
