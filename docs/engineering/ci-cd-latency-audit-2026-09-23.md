# CI/CD latency and freshness audit — 2026-09-23

This audit checks the current workflows and recent GitHub Actions runs for
OrangeCat, Loki, Bitbaum, Heidi, AOZ Begleitung, and evig. Timings below are
elapsed workflow/job wall time from GitHub's run metadata, not a claim that every
minute is CPU time. The observations are tied to the run links so they can be
rechecked as the pipelines change. Follow-up results from later on Sep 23 are
included below where they changed the status.

## Findings

| Project | Observed path | Evidence | Assessment |
| --- | --- | --- | --- |
| OrangeCat | Main CI builds, tests, and uploads the standalone artifact; its `post-main` job dispatches CD with that CI run ID and SHA. CD downloads and deploys the exact artifact. | [CI 35900693365](https://github.com/bitbaum/orangecat/actions/runs/35900693365), [successful CD 35900652349](https://github.com/bitbaum/orangecat/actions/runs/35900652349) | The direct CI-to-CD handoff was already merged in PR #1121. A later dispatch for the same main SHA, [CD 35901401437](https://github.com/bitbaum/orangecat/actions/runs/35901401437), failed in the handoff-validation step because GitHub's Actions API returned HTTP 502. It failed before SSH/deploy; the same main SHA had already deployed successfully. This is transient API fragility plus a noisy duplicate/reconciler dispatch, not a failed production deployment. |
| Loki | CI completes, then the deployment workflow starts from the successful CI event. Recent successful deploy jobs take about 2m50s end to end. | [Deploy 35881210263](https://github.com/bitbaum/loki/actions/runs/35881210263), [Deploy 35880777412](https://github.com/bitbaum/loki/actions/runs/35880777412) | Best current reference for short feedback. The same SHA also had a duplicate manually dispatched deploy cancelled when the event-driven deploy won. Keep one normal handoff and retain reconciliation as recovery. |
| Heidi | `push: main` starts CI and the reusable deploy workflow together; deploy installs, then polls for green CI before building and shipping. | [CI 35777671753](https://github.com/bitbaum/heidi/actions/runs/35777671753), [Deploy 35777672504](https://github.com/bitbaum/heidi/actions/runs/35777672504) | CI took 5m15s; the deploy job took 6m29s and the workflow took 7m12s. The deploy continued about 1m18s after CI turned green. The runner is alive during the CI gate. The app shim still references `bitbaum/fleetcrown`, which GitHub currently redirects to `bitbaum/loki`; this works today but is a stale canonical name. |
| AOZ Begleitung | `master` push starts CI and deploy concurrently; the deploy calls the reusable self-host workflow and waits for CI. | [CI 35228130848](https://github.com/bitbaum/aoz-begleitung/actions/runs/35228130848), [Deploy 35228131587](https://github.com/bitbaum/aoz-begleitung/actions/runs/35228131587) | The last production deploy took 12m08s on Sep 17; CI took 9m43s. The default branch is `master`, and the deploy shim correctly targets it. No later mainline change appears in the current run history, so this is an old-but-current deployment rather than evidence of a missed newer commit. Its shim also uses the redirected `bitbaum/fleetcrown` name. |
| evig | Push starts a standalone deploy workflow that installs and builds, then polls GitHub every 20 seconds for up to 90 attempts (30 minutes) before deploying. | [Deploy 35228314282](https://github.com/bitbaum/evig/actions/runs/35228314282), [CI Pipeline 35859650505](https://github.com/bitbaum/evig/actions/runs/35859650505) | The Sep 17 deploy took 16m51s, including a custom polling gate; its Sep 23 CI run took 8m32s. The code at the latest observed main SHA has not changed since the last deploy, so the elapsed deploy is a structural latency risk, not a confirmed stale production build. The custom deploy logic duplicates the Fleet/Loki reusable path. |
| Bitbaum site | Static HTML is generated from Loki's fleet map and Fleet's package register, with committed snapshots for offline builds. Hetzner/Caddy serves `/opt/bitbaum/app`; this is separate from the GitHub Pages workflow. | [site source and deployment notes](https://github.com/bitbaum/bitbaum/tree/main/site), [registry dispatch verification](https://github.com/bitbaum/bitbaum/actions/runs/35929638587), [latest pinned-runner publish](https://github.com/bitbaum/bitbaum/actions/runs/35929784409) | On Sep 23, after PRs [#59](https://github.com/bitbaum/bitbaum/pull/59), [#60](https://github.com/bitbaum/bitbaum/pull/60), and Fleet [#130](https://github.com/bitbaum/fleet/pull/130), the live `/packages/` response was verified at 10 packages / 62 uses, with paykit and listkit-powered search, facets, sorting, and truthful package profiles. Bitbaum PRs [#61](https://github.com/bitbaum/bitbaum/pull/61), [#63](https://github.com/bitbaum/bitbaum/pull/63), [#65](https://github.com/bitbaum/bitbaum/pull/65), and [#66](https://github.com/bitbaum/bitbaum/pull/66) added live-source-only build, generated snapshot commit, Hetzner publish, exact-SHA Fleet registry-change dispatch, current action runtimes, and a pinned Ubuntu runner. The `repository_dispatch` path was exercised with a Fleet SHA and passed live checks in 44 seconds; the latest push publish completed in 39 seconds with no Node.js deprecation or runner-migration warning. The stale GitHub Pages workflow is still not the deployment signal for the custom domain and should be retired or clearly labelled to avoid confusion. |

## Wall time versus runner time

The poll gates are expensive in runner minutes, but their full duration is not
added to merge-to-live time: deploy and CI start together, so most waiting
overlaps verification. In the measured runs, Heidi's CI passed at 20:07:49 UTC
and its deploy job completed at 20:09:07 (about 1m18s later); AOZ's CI passed
9m43s after start and deploy completed 2m25s later. For evig, the CI run for the
deployed SHA passed at 13:51:28 UTC and production deploy plus smoke completed
at 13:55:01 (3m33s later), although the deploy workflow itself ran for 16m51s.
The gate still holds a runner for 5–13 minutes, consumes capacity, and adds
poll/API failure points. Replacing it with a post-CI trigger primarily saves
that runner time; it does not by itself guarantee faster live updates and may
move setup work onto the critical path. To cut wall time, prioritize artifact
reuse where build environments match and shorten the work after CI turns green.

## What to change

1. **Keep one post-verification handoff.** For each app, let successful CI
   dispatch/call its deploy workflow with the exact CI run and commit. Preserve a
   scheduled reconciler only for recovery. Make the dispatch idempotent against
   the currently live SHA, and ensure it cannot race the normal CI handoff into
   two deploys.
2. **Remove the sleep gate from the hot path.** Heidi, AOZ, and evig should not
   start a deploy runner on the same push and wait for CI. Chain deployment after
   verification instead. Because GITHUB_TOKEN-created pushes do not start
   downstream workflows, the chain must also cover CI re-dispatched by the
   auto-merge sweep; `workflow_run` alone is not sufficient. A deploy job in the
   same main-CI workflow or an explicit dispatch from that workflow can handle
   both event types.
3. **Put shared orchestration in Fleet, host operations in Loki.** Fleet is the
   right owner for CI/deploy policy and reusable GitHub workflows. Loki should
   own Hetzner mechanics: app registry, rsync, atomic swap, health checks,
   rollback, and Caddy/systemd operations. App repos should keep small shims.
   Move the reusable self-host workflow out of the Loki product repo once its
   contract is stable; update callers from the old `fleetcrown` redirect.
4. **Do not impose one artifact format on every app.** OrangeCat already builds
   its standalone artifact in CI and can ship that exact tested output. The
   shared self-host workflow pulls runtime environment from the box before
   building other apps; those apps cannot reuse a CI artifact until required
   build-time configuration and secret handling are explicit. First remove
   idle waits to save runner capacity; standardize artifact contracts where
   compatible to cut post-CI wall time.
5. **Make workflow upgrades reviewable.** Avoid floating shared workflows at
   `@main` for production callers. Publish or record a tested Fleet workflow
   revision, pin callers to it, and have Dependabot/open PRs advance consumers.
   Fleet should track which repos are on the current approved revision.
6. **Make freshness observable.** Record the deployed commit SHA and successful
   health check centrally; show `main SHA`, `deployed SHA`, and age in Fleet's
   audit. For the Bitbaum site, make the Hetzner deploy observable in Actions
   (or explicitly retire the unrelated Pages build) and display the package
   release version if visitors are expected to assess package currency.

## Recommended sequence

1. OrangeCat's [PR #1127](https://github.com/bitbaum/orangecat/pull/1127) has
   merged with all CI checks green. It caches the tested Chromium browser,
   reuses a retained standalone artifact for recovery (and rebuilds when none
   remains), and retries the transient Actions API errors observed in
   production. Its main SHA `4174f53` then passed CI and deployed that artifact;
   CD completed in 1m34s and the live `/api/health` check returned 200.
2. The published shared-kit releases are now also in OrangeCat through
   [PR #1129](https://github.com/bitbaum/orangecat/pull/1129): ai-kit 1.11.0 and
   bip-kit 0.3.1 replace the stale 1.6.0 and 0.2.7 resolutions. The PR merged
   at 19:33 UTC. Main CI [35910159596](https://github.com/bitbaum/orangecat/actions/runs/35910159596)
   passed, then CD [35911006344](https://github.com/bitbaum/orangecat/actions/runs/35911006344)
   deployed SHA `f91c44d` from its standalone artifact. The public health check
   returned 200 at 19:42:44 UTC, so both package updates are live in OrangeCat.
3. The CI-success handoff is now live in Heidi and AOZ through the shared Loki
   reusable workflow: [Heidi PR #100](https://github.com/bitbaum/heidi/pull/100),
   [AOZ PR #249](https://github.com/bitbaum/aoz-begleitung/pull/249). Both
   workflow_run deploys received the exact CI SHA and passed public health
   verification. Heidi's first post-merge CI completed in 5m08s; its deploy
   completed in 1m30s. AOZ's post-merge deploy completed in 1m54s. This removes
   deploy runners waiting beside CI; it does not remove CI runtime from merge-to-live.
4. evig now uses the same contract in [PR #505](https://github.com/bitbaum/evig/pull/505):
   post-CI workflow_run, exact SHA checkout, successful-CI validation, supersede
   protection, and its existing post-deploy smoke. Its required CI checks passed
   before merge. Main SHA `cd5dec1` then deployed successfully in 4m32s through
   workflow_run, and the read-only prod smoke passed. The reusable Loki workflow
   gained `git-ref` support in [Loki PR #867](https://github.com/bitbaum/loki/pull/867),
   with caller guidance in [Loki PR #868](https://github.com/bitbaum/loki/pull/868).
   A stale CI completion was correctly skipped as superseded. A second queued
   workflow_run for the same SHA was canceled after the first deployment passed;
   overlapping push and workflow_dispatch CI runs can still create duplicate
   deploy events and should be deduplicated at the shared handoff/re-arm policy.
5. Remaining architectural work: move the shared self-host workflow from Loki
   to Fleet, replace stale `fleetcrown` references, pin shared workflow revisions,
   and automate consumer updates. Package-version visibility and Bitbaum's site
   deployment signal were addressed separately; keep measuring live freshness.
6. Remove duplicate main CI/deploy triggers where Fleet's re-arm races a push
   run. The supersede guard prevented stale shipping, but several evig workflow_run
   jobs were created for older/equivalent CI events in this rollout. Also update
   Heidi's `actions/checkout@v4` smoke step and any remaining Node.js 20 actions;
   GitHub warned that these are being forced to Node 24. These are maintenance
   follow-ups, not deployment failures.
7. The Fleet package-registry audit is slow at its current scale: a full run
   against 43 repositories took about 2m10s locally because it requests up to
   six manifest paths serially per repository. This is registry-refresh latency,
   not measured app deploy time. Add bounded concurrency or a batched GitHub API
   query, with tests that preserve the distinction between a genuinely missing
   manifest (404) and an unreadable/failed request. The audit must continue to
   fail closed rather than publish partial adoption facts.
8. Internal package currency coverage: the reconciler now gets allowed package
   identities from Fleet's curated registry, so it can update both scoped
   `@bitbaum/*` and unscoped npm dependencies such as `bip-kit`; it resolves
   `npm:` aliases while preserving the manifest alias key. Third-party npm
   dependencies stay with the separate major-version audit. Git-tag packages
   such as listkit remain out until release metadata can distinguish a stable
   versioned tag from a moving branch. Bitbaum's catalogue displays published
   npm versions and maintainer profiles linking README/API and release history;
   it derives adoption from the registry and does not label paykit as adopted.
9. Measure merge-to-live (successful CI, deploy start, deploy health check) over
   representative runs before setting latency targets. The evidence supports
   removing billed wait and duplicate builds, but does not support a universal
   4–5 minute promise.

## Answers to the proposed design

- **OrangeCat direct ship:** correct, and already present in production via
  [PR #1121](https://github.com/bitbaum/orangecat/pull/1121). Improve resilience and idempotence rather than reimplementing the
  handoff.
- **Heidi/AOZ/evig sequencing:** correct. Stop push-plus-poll. Preserve the
  auto-merge `workflow_dispatch` path as well as ordinary push sequencing.
- **Build once, ship the artifact:** correct for OrangeCat's existing standalone
  output; conditional for other apps because their deployment build currently
  receives box-only runtime environment. Do not trade correct production config
  or tested rollback for a blanket artifact rule.
- **A new npm CI/CD kit:** not recommended. This is workflow policy and host
  orchestration; use Fleet workflows and Loki's box scripts, with app shims and
  automated revision updates.
