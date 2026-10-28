# Package and application remediation checklist — 2026-10-28

This is the execution checklist requested after reconciling current npm, Fleet
registers, and GitHub state. It supplements the historical evidence in
[`package-remediation-status.md`](package-remediation-status.md); that document's
older open/closed summaries must not be read as the current state. A task closes
only with the evidence stated here. Package versions and consumer membership
remain derived from Fleet's package and rollout registers.

## Current execution

- [ ] **Shared-package consumer rollout.** Merge the current green Fleet #320
  after its current-head checks, then resolve every still-open generated
  `raise shared package floors` PR from the currency run. Open PRs currently
  include Truthseeker #68, BiasLens #110, Botsmann #245, Loki #1436,
  Diplodoctor #41, OrangeCat #1462, Solon #319, Evig #614, S-ink #50, Skif #69,
  Causius #75, DataCat #315, Vitareba #126, Petvity #125, AOZ #317,
  Surf Your Life #101, and Hirnli #123. Refresh stale candidates instead of
  forcing them. Verify deployment receipts for apps that deploy; no receipt
  substitutes for the app's required journey.
- [ ] **AccountKit 0.9.1 app upgrades.** Refresh/merge Causius #76,
  Diplodoctor #42, Heidi #237, BiasLens #111, Petvity #129, DataCat #314,
  and Loki #1456. Rebuild Substrata #184 against current main and AccountKit;
  preserve stable identities, roles, saved data, and its additive schema. Run
  the database/browser journeys before merge and verify deployed account flows.
- [ ] **ChartKit adoption.** Rebase Kivvi #169 to ChartKit 0.5.0; check localized
  chart labels and dates against real German tenant data, then verify light/dark
  and phone/desktop after deployment. Review the bespoke chart usage in
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
- [ ] **Stale draft PRs.** Reconcile and refresh Hirnli #130, Petvity #106, and
  Surf Your Life #87 against current code and mark ready only when accurate.
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
- AccountKit 0.9.1 and ChatKit 0.21.1 are published.
- Fleet package publishing workflow/template and source-history work are
  merged; they do not establish full app adoption or deployed user journeys.
- Fleet's agent-file audit is installed. The ten findings above are debt already
  recorded by the audit, not regressions newly introduced by this checklist.

