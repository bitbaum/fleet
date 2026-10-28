# Package and application remediation checklist — 2026-10-28

This is the execution checklist requested after reconciling current npm, Fleet
registers, and GitHub state. It supplements the historical evidence in
[`package-remediation-status.md`](package-remediation-status.md); that document's
older open/closed summaries must not be read as the current state. A task closes
only with the evidence stated here. Package versions and consumer membership
remain derived from Fleet's package and rollout registers.

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
  creating/updating PRs. Latest directly queried open candidates at this
  checkpoint: Loki #1436
  (ChatKit 0.21.2 plus current shared floors; hosted check running and rollout
  gate blocked pending its check), Bitbaum #177 (preview check fails because
  checked-in generated site output embeds old ChatKit), and Evig #615 (CI still
  running). Causius #78 and AOZ #327 were green; Substrata #285 was merged.
  These statuses are live and may change. GitHub and npm returned repeated
  upstream HTTP 503s during this execution, preventing fresh remote inventory,
  pushes and merge-sweep triggers.
- [ ] **AccountKit 0.9.1 app upgrades.** Re-query the legacy PRs before
  touching them: some named upgrades merged (including Loki #1456), while
  DataCat #314, Surf Your Life #107, Vitareba #129, Hirnli #148, AOZ #320,
  and Substrata #184 were still stale or dirty at the last source inspection.
  A clean Surf Your Life refresh exists locally at `/tmp/surf-auth-current`,
  commit `31e5902`; formatting, lint, typecheck, all 894 tests, and the focused
  19-test auth suite passed. It is not pushed because GitHub returned repeated
  503 errors. Rebase/refresh each remaining app individually; do not force-merge
  stale checks. Rebuild Substrata #184 against current main and AccountKit;
  preserve stable identities, roles, saved data, and its additive schema. Run
  the database/browser journeys before merge and verify deployed account flows.
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
  migration to that entry point remains in PR #1436 pending CI and the rollout
  gate.
- Fleet package publishing workflow/template and source-history work are
  merged; they do not establish full app adoption or deployed user journeys.
- Fleet's agent-file audit is installed. The ten findings above are debt already
  recorded by the audit, not regressions newly introduced by this checklist.

