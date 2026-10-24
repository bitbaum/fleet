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
checks, and a 24-hour observation period. The latest canary default-branch commit
must be the deployed commit. Another deployment restarts the conservative
observation period. Each consumer must still pass all of its own checks, including successful
`ci.yml` and `browser-smoke.yml` workflows on the candidate commit.

Known first-party packages without a designated canary wait for configuration;
they do not silently promote. Lock-only pnpm root dependency changes are checked,
including pinned Git artifacts; npm lockfile v2/v3 direct dependencies are also
supported. Unsupported lock formats, unavailable API evidence and checker errors
hold automatic merging. Nested workspace dependencies are not covered by this
root dependency gate; they require explicit consumer integration checks before
promotion. Manual merges are not constrained by this script.

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

The existing Loki [self-host deployment workflow](https://github.com/bitbaum/loki/blob/main/.github/workflows/selfhost-deploy.yml)
uses atomic releases and includes health-check and page-regression rollback.
Those checks do not establish correctness of every authenticated or domain flow;
keep those in the consumer test suite. A failed deployment holds promotion.
