# REVIEW.md — the encoded review bar (template)

Copy to a repo root and keep ONLY repo-specific gates + this ordered checklist.
The global standards (@~/.claude/CLAUDE.md) are already loaded — never restate
them here. A review gate earns its line only if violating it has bitten this
repo before or would be fatal. Prune relentlessly.

## How to review (agent or human)

Judge the DIFF against these gates, in this order. Flag only correctness and
requirement gaps — not style (lint owns style). Demand evidence, not assertions.

1. **Fatal invariants** — the repo-specific section below. One violation = block.
2. **Verify is green** — the repo's `verify` script ran and passed. No green, no review.
3. **Migrations finished** — no half-migrated state left behind: no dual-sourced
   data, no old-path + new-path coexisting, no stranded flags. If the diff starts
   a migration, it finishes it or documents the cutover plan in the same PR.
4. **SSOT** — no value/knowledge now lives in two places (code, config, docs).
5. **Docs stay true** — if the diff changes structure/behavior documented in
   CLAUDE.md or README, the same diff updates them. Stale docs = blocked.
6. **Never-twice** — if this diff fixes a bug class a second time, it must add
   the rule/test/check that ends the class (see global CLAUDE.md, Truth #4).

## Repo-specific fatal invariants

(REPLACE per repo — examples:)
- Every query on tenant-scoped tables filters by the tenant id.
- Money is never float; amounts only via the domain money type.
- No secrets in code, config, or fixtures — env vars only.
