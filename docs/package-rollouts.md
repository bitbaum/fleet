# Shared package promotion

Changing a package does not mutate a running consumer. Keep immutable releases,
committed lockfiles and consumer-specific CI. A green package suite is necessary
but cannot establish that auth, CSS, navigation and real workflows still work in
an app.

The automatic merge sweep enforces `registers/package-rollouts.json` for shared
root dependencies in application consumers. Package repositories retain their
own verify/publish gates; downstream apps provide deployment evidence. BiasLens is the initial canary for the seven packages it
actually consumes. A canary dependency PR must pass both `ci.yml` and
`browser-smoke.yml` on its exact head. Every other consumer waits for the same
locked artifact to be deployed on the canary, with successful CI and browser
checks, and an observation period of `soakHours`. That period is **0** while the
canaries have almost no traffic (owner, 2026-10-26): a day on a site nobody uses
observes nothing and only delays every other product by a day. Raise it again
once a canary has real users, so the wait actually watches something. The
latest canary default-branch commit must be the deployed commit. Another
deployment restarts the observation period. Each consumer must still pass all of its own checks, including successful
`ci.yml` and `browser-smoke.yml` workflows on the candidate commit.

Known first-party packages without a designated canary wait for configuration;
they do not silently promote. Lock-only pnpm root dependency changes are checked,
including pinned Git artifacts; npm lockfile v2/v3 direct dependencies are also
supported. Unsupported lock formats, unavailable API evidence and checker errors
hold automatic merging. Changed shared artifacts in nested pnpm importers hold automatic promotion
until workspace-specific canary evidence is supported. Standalone nested dependency manifest changes and nested lockfile updates
with shared dependencies likewise hold automatic promotion. The gate does not
infer compatibility for an integration it cannot evaluate. Manual merges are not constrained by this script.

The first-party `templates/app` starter has a narrow supported path: its full
`ci.yml` must pass on the candidate commit (including clean install, package
verification, production build and the auth integration journey). Shared package
changes in that template still require the exact artifact to deploy on the
designated canary and complete the same observation period. Other nested
manifests remain held until they provide equivalent importer-specific evidence.

For a regression: add the exact locked artifact to `blocked[package]` in the
policy register, fix the package with a regression test and release a new version.
Do not move a published tag. Revert the affected consumer dependency/lockfile PR
to its previous tested artifact and redeploy using its existing deployment
workflow. Verify public routes and the affected user journey. Database migrations
need a separate compatibility and recovery plan; never automatically undo data.

The observation period is a containment measure, not proof of zero bugs. Consumer
browser and domain tests must exercise the real affected workflows. UI packages
need phone/desktop, keyboard, auth-state and theme checks; auth needs database-backed
session/authorization tests. New bugs become regression tests in the owning
package and the affected consumer. Add another representative canary before
promoting into a materially different runtime or integration.

`scripts/ci/package-canary-audit.mjs` verifies that every configured canary
declares its package and has an import/runtime binding in its package plan.
The scheduled `package-canaries.yml` workflow repeats that check against current
default branches. This validates configuration, not deployed journey health.

The currency reconciler also follows registered immutable Git dependencies.
Published packages move to their canonical npm identity (preserving aliases).
Otherwise only stable Git tags with a matching package version and successful
CI on that exact commit are eligible; installed newer commits are never
downgraded to older tags. `templates/package` supplies `git-release.yml`, which
tags verified stable versions even before npm bootstrap. The template sync
offers missing release files to every registered package, not just newly
extracted packages. Existing files remain owned by their repositories.

## Account lifecycle evidence

`.github/workflows/shared-auth-journey.yml` builds the consuming app without auth
secrets, applies its committed migrations to an isolated PostgreSQL database,
then starts the production server with synthetic credentials. Consumers provide
`migrate-command`, `sign-in-path`, and `account-path` through a job in their
`browser-smoke.yml`. The driver captures mail locally through the app's real
adapter; it does not send external mail.

The journey checks registration and role escalation protection, verification,
reset response parity for unknown addresses, return paths, token removal from
browser history, password reset and token reuse, session revocation, old and new
passwords, and browser login into the server-rendered account page. It captures
light and dark reset forms at 320, 390, and 1280 pixels and rejects horizontal
overflow. Building without auth secrets is intentional: it catches session pages
incorrectly cached as signed-out redirects. Logs and screenshots contain synthetic
users; mail bodies and recovery tokens remain in memory.

This journey covers the shared email/password runtime. Apps with Supabase,
organizations, or different account routes require equivalent adapter-specific
journeys before promotion; installing a package does not establish adoption.

The existing Loki [self-host deployment workflow](https://github.com/bitbaum/loki/blob/main/.github/workflows/selfhost-deploy.yml)
uses atomic releases and includes health-check and page-regression rollback.
Those checks do not establish correctness of every authenticated or domain flow;
keep those in the consumer test suite. A failed deployment holds promotion.

## Generated release registry coverage

The shared registry producer discovers every tracked project `package.json`
from each repository tree, including workspaces, examples and starters. Generated
build output and fixture directories are excluded. Truncated trees, malformed
manifests and unavailable APIs prevent publication of a partial registry.

The `adopters` field counts dependency declarations, including development,
workspace, example and starter declarations; it does not prove runtime use or
deployment. Canary bindings and browser journeys supply separate evidence.

Public `registers/packages.json` contains public, active, non-fork repositories.
Use `--include-private` only for a local internal audit; it cannot be combined
with `--emit`, so private adopter names cannot enter the public site.

Release recommendations compare stable npm artifacts with immutable Git tags
that match the package version and passed exact-commit CI. A newer verified Git
release can win over lagging npm; equal versions prefer npm. The record includes
the chosen source and immutable Git commit where applicable. Old consumer pins
and unpublished repository versions never establish the current target.

## Live artifact receipts

`scripts/ci/release-receipt.mjs` records the clean checked-out commit, the selected
lockfile digest, and the canonical locked/installed first-party package versions.
It refuses a dirty or untracked source tree, missing installed packages,
unverified workspace links, mutable branch references, unsupported locks and
mismatched npm versions. It uses the actual Git checkout rather than the
workflow run's label.

A pnpm `workspace:` dependency locked to `link:` may be attested as the owning
repository's immutable Git commit. The CLI checks that the installed package's
real filesystem target is inside the clean checkout, its manifest is tracked,
and its name/version and source path match the locked link. A version number
alone cannot identify a local package. External links, wrong targets and dirty
workspace source still fail; no raw local path is published.

The deployment integration writes the result into the staged public directory
as `/.well-known/fleet-release.json`. It contains no environment, user data,
local paths or unrelated dependency inventory. Public output requires `--public`;
the caller must establish repository visibility before passing that flag.
Private inventory stays internal. pnpm importers and npm v2/v3 project locks
use the same parsers as the rollout gate.

Once a canary actually serves a verified receipt, configure its HTTPS URL in
`registers/package-rollouts.json` under `deploymentReceipts["owner/repo"]`.
The gate then requires the live receipt to match the current commit, complete
canonical artifact map and lockfile digest, in addition to exact CI/browser,
successful deployment and the observation period (`soakHours`). Missing,
stale or malformed live evidence holds promotion. An unconfigured receipt URL
does not claim deployed-artifact verification; deployment integration and live
validation are separate prerequisites to enabling it. Existing nested-consumer
holds remain in place until importer-specific rollout policies are configured.

## Obsolete AccountKit downgrade proposals

Dependabot proposed replacing deployed AccountKit 0.6.3 with 0.2.1 in Heidi
#218 and Solon #304. That artifact lacks the current account runtime and recovery
exports. Both proposals were closed; the obsolete commit and npm version are
blocked centrally, including at the canary. This does not prohibit an intentional
recovery to a compatible, separately verified release through the existing policy.

## Release freshness

The package template's `release-notify.yml` listens to successful release,
publish and CI completions. It requests reconciliation only for a stable tagged
commit with successful exact-commit CI; it never executes workflow artifacts or
pull-request code. Fleet then independently resolves available releases rather
than trusting the notification's version claim. The same event starts consumer
currency planning and the serialized shared inventory refresh, which dispatches
Bitbaum with the exact changed registry commit. Scheduled reconciliation remains
the fallback when a publisher notification fails. Template synchronization adds
this missing workflow to existing packages through their normal checked PRs.

## Different integration classes

A package policy may add `additionalCanaries`, each with its own `canary`,
`canaryAdmission`, checks and receipt/importer configuration. With
`canaryAdmission: "verified-candidate"`, each real candidate PR in the designated
canary repository may enter after its exact configured checks. This applies to
every release: a historical bootstrap PR number must not prevent the next
automated update. Blocked artifacts and candidate checks still apply first.
Legacy policies without this admission mode retain their exact `bootstrapPr`
restriction. The optional `bootstrapPr` remains a binding-audit pointer while
the initial integration PR is open; it is not a permanent release permission
when verified-candidate admission is selected. Every representative
must deploy the same artifact, pass its configured checks and complete the full
observation period before an ordinary consumer can promote. Adding an embedded
page representative therefore supplements, rather than replaces, a workspace
representative. The canary binding audit inspects each representative.

The reusable account lifecycle accepts `integration-check-script`, an optional
product-owned `.mjs` exporting `run({page, base, userId})`. It runs once after
verification of a synthetic account on the local production build; all existing
account lifecycle assertions still run. The check receives an authenticated
browser, not customer credentials. Missing/invalid scripts and failed assertions
fail the workflow. Product tests may intercept model routes with synthetic data
while exercising their actual page, components, styles and scrolling layout.

## Avoiding cross-canary dependency cycles

Currency planning first proposes the packages for which a repository is a
designated representative. Other dependency updates in that repository are
deferred to the next reconciliation. Once those representative packages are
current, its ordinary updates are planned normally. Additional representatives
and nested importers follow the same rule. This changes batching, not admission:
exact-artifact candidate checks, blocked releases and downstream deployment
evidence remain required.

## Consumer verification workflows

`consumerChecks` binds a repository to its actual verification workflows when
its build differs from the normal app template. The static studio runs its
unit, source, accessibility and browser checks in `deploy-site.yml`; it does
not have `ci.yml` or `browser-smoke.yml`. Candidate proof must come from that
workflow on the candidate commit. Other repositories retain package-specific
requirements, and representative deployment proof is still required.


### Browser jobs inside combined consumer CI

`consumerChecks` may require `workflow.yml#Exact job name` alongside the workflow.
This accepts an existing combined CI without duplicating browser runs. The gate
requires the newest eligible workflow on the exact candidate commit, overall
success, and a completed successful job with that exact name. Missing, renamed,
skipped, failed or unreadable job evidence holds promotion. It does not borrow
another commit's browser results.

Evig's `ci.yml#Local E2E Journeys` runs a disposable database, applies migrations,
seeds accounts, builds and starts the app, and runs its actual browser journeys
and authorization guards. Optional production smoke jobs that skip without
credentials do not satisfy this requirement. Canary artifacts, deployment proof
and all other rollout requirements remain in force.
