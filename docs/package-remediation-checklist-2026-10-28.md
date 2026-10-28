# Package and application remediation checklist — 2026-10-28

This is the execution checklist requested after reconciling current npm, Fleet
registers, and GitHub state. It supplements the historical evidence in
[`package-remediation-status.md`](package-remediation-status.md); that document's
older open/closed summaries must not be read as the current state. A task closes
only with the evidence stated here. Package versions and consumer membership
remain derived from Fleet's package and rollout registers.

## Completion contract and execution order

The destination is maintained shared capabilities, not a dependency count.
For each active application, record applicable capabilities, actual source
bindings, exact locked versions, supported domain adapters, checks, deployed
commit and affected journey. A manifest entry alone is not adoption. Unknown
coverage remains open. Use the existing package composition, currency and
rollout registers/checks; extend them rather than create another competing
inventory. Historical evidence below is dated, not live status.

1. Finish AOZ as the active application: compatible security patches, package
   applicability and runtime bindings, auth boundaries, chat, charts/rate limits,
   documentation, required CI and deployed evidence. Necessary shared-package
   changes are prerequisites; return to AOZ after publishing them.
2. Finish the known auth migrations in order: Vitareba, Hirnli, Substrata.
   Reconcile current default branches and other agents' work before edits.
3. Process remaining active apps from the Fleet register, one application at a
   time. Within each, batch compatible adoption, dependency and factual-doc
   fixes; isolate data migrations or incompatible major upgrades. Resolve the
   auth, chat, chart and other applicable-package requirements below together.
4. Close remaining shared automation and instruction defects, then prove one
   unattended release through publication, consumer CI, merge, deployment and
   current-artifact journey. Check failed-step recovery without weakening gates.
5. Regenerate the final matrix from current default branches and deployment
   evidence, reconcile every open remediation PR and publish the closure report.

A new finding belongs here only if it violates an existing acceptance criterion
or blocks its implementation. Separate product ideas are future work. A shared
feature gap needed by an existing app is in scope: improve its owning package,
release it, then adopt it. Do not replace a stronger app implementation with a
weaker package merely to obtain an import.

“Latest” means latest compatible supported release, locked and exercised in the
app. Evaluate incompatible major releases explicitly; never force them blindly.
An exception needs a concrete incompatibility, owner, mitigation and review
condition; lack of investigation is not an exception. No whole app is complete
while applicable capabilities are missing or its required journeys are untested.

Efficiency: focused checks during editing, required full checks once per final
candidate through the normal path, no repeated green suites without a relevant
change. Prepare the active application's next item while CI runs. Do not open
unrelated implementation threads. Preserve other agents' changes, inspect exact
current heads, and let the Fleet sweep merge. Stop only with an exact saved
checkpoint and explicit remaining criteria, never a vague completion claim.

## Verified progress checkpoint — 2026-10-28

- Loki #1436 is merged and deployed at `37c35b4b056813943bae3d983d0f9e7b6590041c`;
  its served widget matched the browser-tested artifact byte for byte.
- AOZ #320 is merged; AccountKit password handling passed auth and hosted checks.
  Eight read-only deployed auth page checks passed on phone and desktop.
- AOZ #328 is merged and deployed at `f6ea40e2e07d877c46cc3904119f2e9351579e7c`.
  Main CI and deployment passed; the live release receipt reports that commit,
  AccountKit 0.9.1, AI Kit 1.21.4 and ChatKit 0.21.2. Full-app browser checks
  cover streaming scroll intent and cancellation in light/dark and phone/desktop.
  Production privileged chat and live email delivery are not thereby proved.
- Fleet #338–339 preserve consumer repair commits during automated updates;
  #340 recognizes AOZ's actual E2E gate; #341 publishes the completion procedure.
- AOZ's compatible security update is local and unmerged. The first updated
  audit removes the critical Sentry tunnel finding; transitive findings remain
  under investigation. This is not yet a completed security audit.

## Current execution

- [x] **Package floor baseline and first consumer wave.** The generated floor
  PRs in the historical status report were processed; many merged, including
  Fleet #320 and the Causius, Diplodoctor, Solon, BiasLens, Botsmann, Heidi,
  Skif, Kivvi, Petvity, AOZ, OrangeCat, Truthseeker, S-ink, Evig, DataCat,
  Vitareba, Surf Your Life, and Hirnli package-floor waves. This does not close
  the continuing-currency task below. Evidence: current registry and PR queries
  on 2026-10-28.
- [ ] **Current package floor reconciliation.** Close only after regenerating
  the live app/package matrix from the current registry and every active repo's
  lockfile. This is not complete: a read-only scan of the cached app/package
  checkouts found older declared floors in AOZ, BiasLens, Bitbaum, Botsmann,
  Causius, DataCat, Diplodoctor, Evig, Fleet's template, Heidi, Hirnli, Kivvi,
  Loki and its site template, OrangeCat, Petvity, S-ink, SBB Fundbüro, Skif,
  Solon, Substrata, Surf Your Life, Truthseeker and Vitareba. The cached checkout
  refs are not proof of current GitHub main, so regenerate from live refs before
  creating/updating PRs. Bitbaum #177, Evig #615, Causius #78, AOZ #327,
  Substrata #285, and Fleet #336 are now merged. Loki #1436 has the compact
  embedded stylesheet fix and isolated Git fixture test at commit `7be801ec`;
  its pre-push checks passed 546 unit-test files and 130 home cases. Hosted CI
  subsequently passed; deployment evidence is recorded above. Fleet #338 and #339 merged a guard and its
  regression checks: currency automation preserves consumer repair commits
  instead of overwriting them on its next run. The accidental temporary Surf
  currency branch was deleted successfully.
- [ ] **AccountKit 0.9.1 app upgrades.** Surf Your Life #107 and DataCat #314
  are now merged after refreshed checks. Surf passed 894 tests; DataCat passed
  23 backend tests, backend/frontend lint, frontend formatting and typecheck.
  AOZ #320 was refreshed onto current master at `e9435763`, uses AccountKit
  hashing without bcrypt's 72-byte truncation, retains legacy hash reading,
  and passed 443 auth tests plus typecheck/lint locally. The auth update subsequently merged and deployed.
  Vitareba #129, Hirnli #148 and Substrata #184 remain to refresh and validate.
  Several older upgrade PRs (Causius #76, Diplodoctor #42, Heidi #237,
  BiasLens #111 and Petvity #129) were CLOSED rather than merged; inspect their
  current source and superseding PRs before counting them as adopted.
  Rebuild Substrata against current AccountKit; preserve stable identities,
  roles, saved data and its additive schema. Run database/browser journeys
  before merge and verify deployed account flows.
- [ ] **ChartKit adoption.** Kivvi #169 merged and the consumer floor was raised;
  verify localized labels and dates against real German tenant data, then verify
  light/dark and phone/desktop after deployment. Review bespoke chart usage in
  Petvity, Vitareba, Hirnli, and Evig against ChartKit's released capabilities;
  migrate eligible uses, keep only evidenced feature gaps as exceptions.
- [ ] **Authentication parity.** Build the current app/provider matrix from
  source and runtime configuration. Complete the shared social broker and test
  configured OrangeCat, Google, GitHub, and X callbacks in each eligible app.
  Confirm local password/recovery access survives broker failure. Verify signup,
  email verification/resend, login, recovery, session revocation, passkeys and
  second-factor recovery per app. Do not advertise an unconfigured provider.
- [ ] **AI Kit and ChatKit integration.** Inventory actual model routes and chat
  surfaces across the 61-repository source census. Move ordinary duplicate
  provider/streaming behavior to AI Kit and shared chat behavior to ChatKit;
  retain documented domain adapters. Exercise real app bindings for streaming,
  fragmented data, errors, cancellation, retry/fallback, usage/BYOK isolation,
  scroll intent, composer lifecycle, citations/actions, and mobile layouts.
- [ ] **Agent instruction findings.** Close the ten findings in
  `scripts/ci/agent-files.baseline`: BiasLens, Evig (two), Kivvi, Loki,
  OrangeCat, Petvity, Substrata, Surf Your Life, and Vitareba. Refresh generated
  rules, reduce each `CLAUDE.md` to a pointer, remove Evig's personal-home import,
  then delete only findings proven gone from the baseline. Extend coverage to
  private repositories and editor-specific instruction files.
- [ ] **Stale draft PRs.** Re-query the PRs and branches before taking action.
  Reconcile Hirnli #130, Petvity #106, and Surf Your Life #87 against current
  code and mark ready only when accurate.
  AOZ #255 is already closed. Kivvi #125 is encrypted company-AI-key handling,
  not a copy-drift PR; review it separately for current security behavior.
  Reconcile Bitbaum #119, #123, and #103 against current registers and site.
- [ ] **Truth dependencies and package pages.** Keep the 17 package pages
  sourced from package/release registers; verify current served output after
  publishing. Link factual help/marketing claims to their owning producer and
  deployed evidence; wire producer changes to regeneration or editorial work.
  Preserve dated history and record corrections without rewriting old releases.
- [ ] **Security and dependency review.** Expand the previous 38-lockfile scan
  across all active public/private repos, nested lock roots, native/Python
  projects, and production/development dependencies. Triage advisories; land
  compatible patches and isolate major upgrades. Recheck known Loki desktop and
  development findings.
- [ ] **Release-to-user unattended proof.** Demonstrate one package release
  flowing through trusted publication/provenance, notification, exact locked
  consumer update, required CI, auto-merge, deployment, current-artifact user
  journey, receipt, and reconciliation without manual intervention. Record
  recovery behavior for a failed step. No arbitrary 24-hour wait is required;
  close when the defined signals pass.
- [ ] **Final census and status reconciliation.** Review every active repository
  and package/app pair as adopted-and-exercised, missing, inapplicable, or a
  narrow supported exception with an owner and review condition. Reconcile
  outstanding worktrees/PRs, refresh this checklist, and close only items with
  the evidence above.

## Already resolved and excluded from the open work

- ChartKit 0.5.0 includes locale-aware rendering, reference bands, stacked
  columns, doughnuts, and verified React 18 compatibility.
- PayKit 0.1.1 is published with provenance.
- AccountKit 0.9.1 and ChatKit 0.21.2 are published. ChatKit's 0.21.2 release
  includes provenance and a compact stylesheet for embedded clients; Loki's
  migration to that entry point shipped in PR #1436 with deployment evidence above.
- Fleet package publishing workflow/template and source-history work are
  merged; they do not establish full app adoption or deployed user journeys.
- Fleet's agent-file audit is installed. The ten findings above are debt already
  recorded by the audit, not regressions newly introduced by this checklist.

