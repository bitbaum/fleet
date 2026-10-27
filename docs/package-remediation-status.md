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
| B1 | Complete public/private/nested/fork census | implementing | Source-level package capture covers all 61 active repositories, including all 9 private repositories and the fork. OpenClaw's checkout is incomplete, so its exact Git object tree was reviewed instead: 34,974 tracked paths, 180 package manifests and all lockfiles; no first-party kit references. Finish applicability/domain review and reconcile per-consumer candidates. |
| B2 | Reconcile outstanding PRs and worktrees | implementing | Preserve newer owner work, deduplicate candidates and track superseded targets. |
| C1 | All-kit verified release paths and publication | implementing | AccountKit Trusted Publisher is configured. `@bitbaum/accountkit@0.8.0` is on npm with GitHub Actions provenance (publish run 40484264739); the canonical tag retry is a successful no-op (40487300526). Verify every other kit and supported alias path. |
| C2 | Release notification and consumer propagation | validating | The canonical `v0.8.0` tag notification succeeded (AccountKit 40487347801) and dispatched Fleet currency run 40487371026, now in progress. Fleet #279 merged as 0724f24 after fixing bounded, fail-closed reads; its required CI passed. Complete generated PRs, exact app gates and deployments from this release cycle. |
| C3 | Multiple representative integration classes | validating | Fleet #249/#250/#257 merged; Kivvi and authenticated embedded Causius use npm ChatKit 0.17.1 with successful deployed receipts. Reconcile remaining kit representative classes. |
| C4 | Protected branches and compatible automated writers | implementing | Causius, Heidi and Fleet required checks are applied and verified. Fleet registry/readings/origin writers create generated PRs; all three operational runs passed (40468652046/40468655648/40468660020). Bitbaum #148 and Fleet #270 convert site snapshots to a pinned first-party generated-PR helper; its latest production publish is still running. Verify an actual generated snapshot PR and assess package-release writers before extending branch enforcement. |
| C5 | Package repository merge defaults | complete | Fleet #286/#288 merged. Package-repos run 40502186462 enabled and read-back verified both settings in every registered package repo; independent API read confirms 17/17 auto-merge and 17/17 merged-head cleanup. Daily reconciliation and package-creation defaults are live. |
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
| F3 | Package reference pages and authored histories | validating | Bitbaum #146/#147 published and repaired 17 package references; all 17 public source/version contracts passed. AccountKit #31 adds release-sourced history; confirm its current publication and inventory the remaining package changelogs from verified release sources. |
| G1 | Deployment evidence, observations and recovery | implementing | Public receipt coverage improved through verified Loki/Evig deployments, DataCat browser gating and Camille/Surf fixes. OrangeCat #1456 and Bitbaum #167 are validating. Recheck Substrata availability, then complete current-artifact user journeys and recovery evidence. |
| G2 | Second automated update cycle and final reconciliation | open | Demonstrate another real release progressing without owner intervention; rescan estate and close only evidenced tasks. |

## Established evidence and limitations

- Prior BiasLens controlled production journey verified actual verification/reset
  delivery, token reuse rejection, session revocation and identity continuity.
  It certifies that tested deployment, not every later artifact or other app.
- Causius deployed ChatKit 0.17.1 and app lifecycle repair passed actual phone
  and desktop synthetic matter journeys. Its separate production mail gap
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

Registry, readings and origin-proof refreshes open generated PRs, using the existing GitHub CLI branch/lease approach. The initial third-party
action was rejected by organization policy during operational testing and was
replaced without relaxing that policy. Changed registry facts are
not announced to the public catalogue until they have landed on main. A main
registry merge triggers a fresh inventory run; unchanged facts retry missed
catalogue notifications with the exact landed SHA. The CI writer check now
explicitly forbids direct main workflow writers, including ones that re-arm CI.
Feature-branch currency updates remain allowed. Converted writers passed three
production exercises and each produced a generated PR. Fleet's required-check
application succeeded and read back on its default branch in run
`40478077209`; the current main also enforces verification and the rendered
starter check. Continue checking future runs and finish other repositories' writer
and branch-policy audits before treating this as an organization-wide control.

## 2026-10-27 continuation checkpoint

- ChatKit 0.17.1 and the Causius, Kivvi, BiasLens, Substrata, Heidi and
  Diplodoctor package artifacts are recorded in current public deployment
  receipts. Causius #52 is the first receipt using AccountKit 0.8.0; its
  production registration/recovery lifecycle must be re-certified against that
  artifact. Diplodoctor's seven browser journeys and 13 database integration
  tests were run against the deployed 0.8.0 candidate, while production social
  provider parity remains unverified.
- Fleet #264 makes verified canary candidates repeatable; #269 proposes a
  package's canary update before its ordinary consumers. #274 separates evidence
  by workspace importer, and #275 binds Bitbaum package candidates to its actual
  site verification workflow. The corrected Bitbaum #145 preview/site journey
  check is currently running; no merge is claimed until it passes and the normal
  sweep admits it.
- Bitbaum #148 now proposes checked generated snapshots through Fleet's pinned
  first-party helper. The 2026-10-27 production build is still publishing and
  must finish its live checks and create/refresh its generated PR before this
  writer conversion is considered operationally proven.
- The refreshed portfolio closure scan found 20 public applications with
  configured URLs, 8 current receipts and 12 unavailable receipts. It does not
  include private applications in the public report, and no current-deployment
  account/chat journey is inferred from a receipt. Source-level package capture
  covers all 61 active repositories. OpenClaw was reviewed from its exact Git
  object tree because the temporary working tree contains staged deletions; its
  manifests and lockfiles contain no first-party kit references. These are
  evidence gaps, not proof that the apps are broken.
- AccountKit 0.8.0 remains pinned to immutable Git in current consumers, and
  npm now advertises 0.8.0. The successful npm publication has GitHub Actions
  provenance; it was rerun from main commit `51f713e`, whose only changes after
  the canonical `v0.8.0` source commit `a303242` are `README.md` and
  `CHANGELOG.md`. A workflow run on the canonical tag then verified the release
  notification path and started Fleet's consumer reconciliation. This proves
  the AccountKit OIDC publisher and dispatch path, not every package's release
  path or every consumer deployment.
- Fleet #279 (`0724f24`) makes idempotent cross-repository reads resilient to
  recognized transient limits while keeping permission failures fail-closed.
  Required CI passed, and a local read-only scan completed all 61 repositories
  with five already-baselined contradictions and no new findings. The next
  AccountKit-triggered Fleet currency run is still in progress; this does not
  yet prove consumer PRs or deployments.

## 2026-10-27 repository-setting and API-load follow-through

- GitHub's `Allow auto-merge` is a repository-level capability, while automatic
  head-branch deletion is a separate repository-level option. They were not
  enabled by default from checked-in workflows. The initial audit found 5/17
  and 2/17 respectively. Fleet #286 adds fail-closed daily reconciliation and
  package-creation defaults. Production run `40502186462` enabled both settings
  in all 17 repositories, verified each write with a read-back, and a second
  independent API scan confirmed 17/17 for each setting. The central Fleet
  sweep remains the intended merge authority; enabling the GitHub capability
  alone does not auto-merge open PRs.
- Fleet's behind-branch update used the repository `GITHUB_TOKEN`, which
  produces `action_required` pull-request runs without jobs. #286 changes that
  one write to use the same shared PAT as the eventual merge; without the PAT,
  the sweep leaves the branch untouched. The real test suite covers both paths.
- The full organization drift census ran in ordinary Fleet PR CI and collided
  with the internal package-currency census at GitHub's primary API limit. The
  global scan now has a dedicated daily workflow and runs on shared-truth
  register/checker changes; changed app documents remain checked by the
  existing per-PR docs gate. This reduces redundant org-wide reads. The new
  workflow and Fleet PR checks passed after the unrelated-org scan was removed
  from general CI.
- The first settings dispatch (`40501348449`) ran while the shared PAT was
  rate-limited. That exposed the package creator's unsafe behavior of treating
  every failed repository lookup as absence. Fleet #288 now treats only an
  explicit 404 as a missing repo; the rate-limited attempt made no repository
  changes. A subsequent run after quota recovery passed and applied all 17
  settings.

## 2026-10-27 consumer rollout follow-through

- Causius #62 merged, deployed successfully (`40535024086`), and its public
  release receipt serves commit `e09cf2c6d618c17e1206728a1362599cc3585c85` with
  AccountKit 0.8.0, AI Kit 1.21.4 and ChatKit 0.19.0. A successful receipt is
  artifact/deployment evidence; it does not re-certify every account journey.
- Currency run `40502355833` completed 20 consumer jobs successfully; Substrata
  refused a stale source snapshot. Fresh run `40534819598` is reconciling the
  estate again. Its Causius candidate became stale when #62 merged, so the
  guarded refusal is expected; inspect current manifests rather than retrying
  that obsolete plan.
- Kivvi's current build exposed incompatible Recharts formatter annotations and
  a private next-themes type import. PR #157 repairs them using contextual chart
  types and props inferred from the public theme component. Full local
  `pnpm verify` passes. CI, merge and the deployed receipt remain pending.
- PayKit #7 aligned publishing with the working AccountKit OIDC path and
  explicitly requests provenance. Real publish run `40534971260` still fails
  with npm `ENEEDAUTH`. npm continues to advertise 0.1.0; v0.1.1 is available
  as a verified Git release. Saved npm Trusted Publisher configuration cannot
  be inspected or changed with this session's GitHub-only administration access.
  Do not describe npm publication as complete or repeat identical failed runs.


## 2026-10-27 live receipt closure

- Kivvi #157 merged after full local verification and green CI/browser checks.
  Its live receipt serves `608af26c73f66452efa30053069695467503bc67` with
  ChatKit 0.20.0 and AI Kit 1.21.4. This closes the reported build failure,
  not the separate account-engine migration or all user journeys.
- PayKit's diagnostic mode (#8) exercised the actual npm OIDC exchange without
  publishing. Run `40543445302` confirms repository `bitbaum/paykit`, repository
  ID `1383527729`, workflow `publish.yml` on main and audience
  `npm:registry.npmjs.org`; npm rejected that identity with HTTP 404.
  Configuration may exist but is not accepting this identity. Neither token
  was logged. npm administration access remains unavailable in this session.
- A fresh public-map scan still found 8/20 structurally valid receipts. The
  existing gated redeployment path added Botsmann's first available receipt
  (`40544835489`), revealing its old deployed ChatKit 0.12.0/AI Kit 1.21.0.
  DataCat, Petvity and Skif gated redeployments are running. Loki #1447 wires
  the existing producer into its separate deployment path; CI is pending.
- `scripts/ci/verify-live-release-receipt.mjs --url <https-url> --expected
  <staged-receipt.json>` compares a live receipt with the complete staged
  contract through the existing receipt matcher. Wrong commits, locks,
  importer scope, artifact maps, unavailable responses and invalid JSON fail.
  This is a reusable deployment check; adding it does not certify an app
  until its real deployed verification passes.
- Botsmann, Petvity and Skif gated redeployments passed and now serve receipts;
  the follow-up public scan reached 11/20. DataCat deployed successfully but
  exposed a shared producer bug: source project `frontend` was used as a lock
  importer even though its independent frontend lockfile's importer is `.`.
  Fleet #293 separates source identity from lock-relative importer identity.
  Regression CLI fixtures cover both pnpm and npm independent nested locks;
  DataCat receipt/deployment verification remains pending that repair.


## 2026-10-27 exact deployed-artifact follow-through

- Fleet #294 declares Loki's pinned starter mirror as owned by Fleet and updated
  through its dedicated sync workflow. Currency still audits that mirror but no
  longer edits it independently. It also wires the existing `FLEET_PAT` into
  Fleet's own behind-branch refresh, which had stranded the generated PR queue.
  The source/ownership and merge-sweep regressions passed before merge.
- Loki #1447/#1448 merged. The custom deployment now stages the shared receipt,
  exempts only its exact public path from the auth proxy, and compares the
  served receipt with the staged artifact. Deployment `40552120096` passed;
  a later successful deployment also serves a valid receipt. The route tests
  preserve protection of neighboring and suffixed paths.
- Evig #604 merged after its full CI, database/browser journeys and security
  checks passed. Its custom deployment stages the receipt inside the release
  tree and verifies the served copy. Deployment `40551084063` passed and the
  public receipt is available. No account-engine migration is inferred.
- DataCat #299 adds actual shared-article browser journeys at phone and desktop
  widths, including server-rendered content and navigation. Browser run
  `40549639939` and canonical frontend CI passed; the rollout gate is retained.
  The supported Ubuntu LTS runner avoids the locked browser's unsupported
  ubuntu-latest transition. DataCat now serves a valid nested-project receipt.
- Surf Your Life #102 merged and deployed (`40591687581`). Only the exact
  receipt path bypasses login and locale redirection. Full verification passed
  all 894 tests, including eight real Next matcher checks; its public receipt
  is now readable. Adjacent paths remain protected.
- Camille #45 merged and deployed (`40591902682`). Reproducing Next's own type
  generator showed that tracked declarations changed during build; a compiler
  cache was also tracked. Machine-owned declaration formatting is preserved,
  the cache is untracked, and CI checks clean tracked source after build.
  Full verification, four content tests, production build and clean-source
  receipt generation passed. The actual public receipt is now available.
- OrangeCat #1456 proposes shared exact-checkout receipts for its custom
  artifact deployment, a post-deploy served comparison, and a public asset
  assembly correction. Bitbaum #167 proposes generator-package receipts with
  an explicit distinction between generator source and refreshed catalogue
  data. Both remain pending their required CI, merge and real deployment;
  neither is counted as production verified.
- Read-only scans observed valid receipts for 18 distinct public applications;
  the latest complete scan returned 17/20 because Substrata timed out. This is
  an availability finding to investigate, not evidence of a valid current
  Substrata deployment. OrangeCat and Bitbaum still lack served receipts.
- Botsmann #238 remains held by the real rollout gate because the required
  browser workflow is absent. Add the actual app journeys rather than waive
  that requirement. Current receipt still shows older shared artifacts.

The full completion plan remains open: applicable package adoption, social broker
and provider parity, specialized auth migrations, current-artifact chat/account
journeys, security upgrades, authored histories and semantic claim dependencies
still require evidence. Receipt availability alone does not close those tasks.
