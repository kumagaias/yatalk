# Yatalk PRD-only environment

- Goal: keep the hackathon prototype to one Terraform environment to control cloud costs.
- Decision: use `main` and one task branch, with `infra/environments/prd` as the only environment. Keep the existing `yatalk-dev-*` resource IDs and state bucket to preserve the deployed preview and avoid duplicate resources.
- Changes: renamed the Terraform root and auto tfvars file to `prd`; migrated the GCS state prefix from `yatalk/dev` to `yatalk/prd`; updated environment documentation and global infrastructure guidance; added an isolated root `make test` target required by the commit hook so test imports do not open the root `.env` FIFO. The old state prefix remains available for recovery.
- Checks: Terraform 1.17.1; formatting and validation passed; the PRD and retained old state prefixes each contain 35 resource addresses; the read-only PRD plan reported 0 add, 0 change, 0 destroy; staged Gitleaks scan found no leaks. `.env` remains ignored and no local Terraform state or backup is present.
- Next: add `develop` and `dev` together only if the prototype later needs a separate integration environment.
