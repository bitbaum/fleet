# Package remediation execution checklist

Scope and operating agreement: [approved completion plan](package-remediation.md).
Facts/versions are read from Fleet registers and actual deployment receipts;
this checklist tracks work and evidence, not a competing package inventory.

States: open, implementing, validating, observing, blocked, complete. Per-consumer
work expands under the owning task after the census, with prerequisites, target
artifact, evidence, next action and any blocker. Private task details stay private.

| ID | Work | State | Next action / acceptance |
| --- | --- | --- | --- |
| A1 | Causius actual-page lifecycle and ChatKit scrolling | complete | ChatKit #38 released npm 0.17.1; Causius #57 deployed 635c55c with exact receipt. Actual authenticated synthetic matter journeys passed at 390/1280px including touch/wheel, working status and reply completion; test account deleted. Kivvi #154 deployed the same artifact. |
| B1 | Complete public/private/nested/fork census | implementing | Captured all 61 active repositories at recorded source SHAs, including 9 private and 1 fork. Complete applicability/domain review and reconcile generated per-consumer candidates; source imports alone do not prove adoption. |
| B2 | Reconcile outstanding PRs and worktrees | implementing | Preserve newer owner work, deduplicate candidates and track superseded targets. |
| C1 | All-kit verified release paths and publication | implementing | Resolve AccountKit npm authentication or retain supported immutable Git; verify all release artifacts and aliases. |
| C2 | Release notification and consumer propagation | validating | Fleet #247/#258 merged; actual inventory run 40449285359 passed publication and dispatch after concurrent-main retry repair. Resolve staged npm publication visibility and complete the entire second-cycle deployment path. |
| C3 | Multiple representative integration classes | validating | Fleet #249/#250/#257 merged; Kivvi and authenticated embedded Causius use npm ChatKit 0.17.1 with successful deployed receipts. Reconcile remaining kit representative classes. |
| C4 | Protected branches and compatible automated writers | implementing | Causius/Heidi strict verify + account lifecycle checks enforced for admins and read back (run 40452397109). Fleet registry/readings/origin writers are being converted to generated PRs before Fleet enforcement. Bitbaum and package-release writers remain open. |
| D1 | Shared account lifecycle and current reference apps | implementing | Causius shared mail was present on disk but absent from its running process. Canonical launch regeneration and guarded restart repaired it; #58/#59 merged. Production verification/reset delivery, browser reset, revocation, identity continuity and token reuse checks passed; synthetic account deleted. Inspect remaining deployed runtime/config mismatches and reconcile reference artifacts. |
| D2 | Shared social broker and provider parity | open | Inspect intended broker/configuration; verify OrangeCat/Google/GitHub/X and local fallbacks, or name exact external blockers. |
| D3 | Diplodoctor and organization extensions | implementing | Diplodoctor #32 merged/deployed fd1c72b with exact AccountKit 0.8.0 Git artifact, 13 Postgres tests, seven browser journeys and passing external live check. Continue organization parity, SiteKit shell adoption and social-provider verification. |
| D4 | Remaining auth-engine and specialized-app waves | open | Expand per-consumer migrations with identity/tenant/role reconciliation; preserve justified Supabase integrations. |
| E1 | AI Kit and ordinary duplicate provider paths | implementing | Retain prior SSE fixes; reconcile remaining routes, failure/cancellation/BYOK contracts and actual deployments. |
| E2 | Every chat surface and domain fixture | implementing | Inventory all surfaces; verify actual bindings and teaching/evidence/voice/workspace differences. |
| E3 | Every other shared and product-local package | open | Expand applicable adoption and owner fixes per the plan's package table; test released artifacts. |
| E4 | Security, supported dependencies and runtime majors | implementing | Refresh advisories/current locks; separate compatible updates from tested major migrations and fork/native-ecosystem work. |
| F1 | Starters, templates and package selection gates | implementing | Verify generated consistency and new-project composition; remove contradictory instructions. |
| F2 | Code-to-document/marketing claim dependencies | open | Generate derived claims, track editorial effects, verify actual public availability and correction history. |
| F3 | Package reference pages and authored histories | validating | Bitbaum #146 published 17 references; 102 served-page checks passed for that batch. Bitbaum #147 merged/deployed per-card source/version contract repair (22 tests; 102 browser checks); actual public contract passed all 17 cards. Complete missing authored histories without fabrication. |
| G1 | Deployment evidence, observations and recovery | open | Collect exact receipts and deployed user journeys for each consumer; retain observation periods and recovery evidence. |
| G2 | Second automated update cycle and final reconciliation | open | Demonstrate another real release progressing without owner intervention; rescan estate and close only evidenced tasks. |

## Established evidence and limitations

- Prior BiasLens controlled production journey verified actual verification/reset
  delivery, token reuse rejection, session revocation and identity continuity.
  It certifies that tested deployment, not every later artifact or other app.
- Causius deployed ChatKit 0.17.1 and app lifecycle repair passed actual phone
  and desktop synthetic matter journeys. Its separate production mail gap remains
  was subsequently repaired under D1 and independently verified with controlled
  verification/reset delivery, revocation and identity-continuity checks. This
  does not certify other apps or social-provider availability.
- Package-page publication and CI passing are not universal app integration proof.
- GitHub maintenance administration is available. npm/provider-console authority
  is separately assessed; no broad credential request is implied.

## 2026-10-27 production follow-through

- Causius #59 deployed `129ea1732432da340bdea63f63b6d81da7767887`.
  Read-only inspection distinguished shared configuration from the running process;
  Loki's existing single-app infrastructure generator restored inherited mail
  configuration without copying or rotating credentials. Verification and reset
  messages reached the controlled inbox. Browser reset, old-session revocation,
  old-password rejection, identity continuity and one-time token behavior passed;
  the synthetic account was deleted. Both scroll widths passed in production.
- Diplodoctor #32 deployed `fd1c72b889e9c808c7f38a8f752fa7a1ea68725c`.
  Public receipt matches immutable AccountKit 0.8.0 artifact
  `a303242f586d7ac2b2568bbe8d3da94d8b0be768`; deployment and external live
  checks passed. Its current-artifact local database/browser journeys passed;
  this is not a claim of tested production social-provider parity.
- Bitbaum publication run `40450251845` passed; the actual public package cards
  passed all 17 version/source comparisons. Authored histories remain open.
- Fleet currency run `40450759883` started downstream updates. Concurrent source
  changes correctly stop stale candidates; refresh the census rather than
  overriding newer changes. Estate-wide adoption remains incomplete.

## Required-check enforcement wave

Causius and Heidi have verified `verify` and `account / lifecycle` checks and no
workflow writing directly to their default branches. The opt-in
`app-required-checks.yml` first inspects maintenance administration, applied
rulesets and exact-main check results. Its apply action requires both checks
from GitHub Actions, including for administrators, and requires an up-to-date
branch. The existing sweep updates behind branches. Existing stronger review
and push restrictions are preserved; force pushes and deletion are disabled.

Default action is read-only. Active inherited rulesets or incomplete/stale main
checks stop enforcement. Fleet/Bitbaum/package-release writers still require
conversion before those repositories enter this enforcement wave.

## Generated Fleet writers

Registry, readings and origin-proof refreshes open generated PRs, with the PR
creation action pinned to its verified v8.1.1 commit. Changed registry facts are
not announced to the public catalogue until they have landed on main. A main
registry merge triggers a fresh inventory run; unchanged facts retry missed
catalogue notifications with the exact landed SHA. The CI writer check now
explicitly forbids direct main workflow writers, including ones that re-arm CI.
Feature-branch currency updates remain allowed. Production exercise of the
converted writers and Fleet enforcement are still pending.
