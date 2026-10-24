# Agents

Read `bitbaum/fleet` `AGENTS.md` and the registers it names before inventing a
host, a name, or a page. Do not copy those facts into this file.

Before you finish, check that the docs you touched still describe the code:
`node <fleet>/scripts/ci/docs-truth-audit.mjs --dir .` — the same check the
auto-merge sweep runs on every PR.

Repo-only notes live below this line.

Before implementing any feature, read Fleet `SHARED.md` and review this product's
`package-plan.json`. Choose and wire the existing building blocks first; add
product-specific code only for the domain behavior or a documented package gap.
Keep shared fixes in their owning package. Shared package composition CI checks
that adoption is real and that dependency updates remain enabled.
