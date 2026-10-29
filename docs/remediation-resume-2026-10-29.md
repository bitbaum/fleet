# Remediation checkpoint — 2026-10-29

The full plan remains open. Continue with AOZ as the active application under
[the completion procedure](repository-completion.md). The acceptance queue is
[the remediation checklist](package-remediation-checklist-2026-10-28.md); a
package being installed or a PR being merged does not close the application.

## Verified in this execution

- AOZ #335 merged through the Fleet sweep at
  `8ab6b9192ff83688fb3fdca25a7a73d114f47c91`. Its public header/footer compose
  SiteKit 0.4.2, the design composition layer is 1.2.0, and 21 date controls
  use WhenKit 0.3.3. The package plan records bindings and explicitly marks
  the wider auth, search and list work as open.
- Full local verification passed 287 files / 4,582 tests, lint (10 warnings,
  no errors), types and production build. Twenty-seven selected browser checks
  passed across the initial run and the corrected five-test rerun. Coverage
  includes date form values, public navigation without JavaScript, mobile
  layouts and private-message reconciliation. Hosted PR and merged-main CI
  passed. Deployment run `40820630570` passed and the served receipt identifies
  the merge commit. [Deployed public-shell evidence](../proofs/2026-10-29/aoz-public-shell.json)
  records 390/834/1440px, light/dark, active navigation, no horizontal overflow,
  no page errors and no-JavaScript navigation. It certifies only that scope.
- AOZ's current full dependency audit reports zero high/critical advisories
  and one moderate advisory under Drizzle Kit's development esbuild dependency.
  This is an AOZ lockfile observation, not a fleet security census.
- AOZ #334's messaging fix was already on the deployed commit when this
  execution started (`4857bba7c79e6ed5d0602da733cdc4ad7acface9`). Its CI and
  deployment passed. The authenticated private-message reconciliation tests
  passed against the isolated database. Production authorization behavior
  was not exercised with a real account in this execution.
- AccountKit #40 merged at `c9fb1e59e124638ca7a1c36e00a76fef8aba20c7` and
  published 0.9.2. The registry supplies SLSA provenance, publish run
  `40820628852` passed, and release notification reached Fleet. The runtime
  accepts an opt-in legacy bcrypt adapter, preserving plain bcrypt and `$bs1$`
  credentials while writing native scrypt on registration/reset. Full verify
  passed 115 tests and the browser suite; database tests prove stable user ids,
  old/new passwords, long suffixes, token reuse rejection and session revocation.
  AOZ #336 subsequently merged a dependency-floor update at `80db2f7bdbf71adef237683679dfef4b4470d85b`.
  That dependency update does not complete the shared-runtime data migration.

## Active prerequisite and remaining AOZ acceptance

AccountKit #41 merged at `4d62ab8ebed295a9b0af8bda0838fb01bd336418`.
Version 0.10.0 is published: npm identifies this exact source commit and supplies
SLSA provenance; publish run `40822181927` passed. Full local verification
passed 116 tests and browser checks; hosted CI passed. The opt-in domain proof
adapter issues shared revocable sessions, binds product restrictions before
cookies are exposed, and denies code-only account-security changes and MFA
bypass. Domain sessions have fixed expiry so their restrictions cannot expire
before a sliding session does. The runtime can map an existing deployment's
secret names without changing process.env. Consumer rollout gates still apply.

AOZ #338 is open at `ac4e5f57d06adef6236332540396cb6990d2e03a`.
It uses SearchKit for survey-recipient names and ListKit for selection toggles
and SQL wildcard escaping. Full local verification passed 289 files / 4,585
tests and the production build. Four isolated-database browser journeys passed
at 390/1280px in light/dark, preserving selected recipients while a typo search
hides them. Exact-head hosted CI and composition checks passed. Merge and
deployment remain unverified; do not bypass the Fleet sweep. This is partial
adoption, not closure of remaining SQL searches or filter codecs.

The next auth design must also preserve unclaimed/invited accounts when they
receive their first email/password, and link a second domain identity only
after proof of the existing account. Do not introduce an app-owned credential
lifecycle merely to bridge a missing shared provisioning operation.

AOZ still needs the full AccountKit migration: additive schema and identity
mapping; preserved bcrypt hashes and dual identities; registration and
single-use staff invitations; revocable staff/resident sessions; shared recovery,
verification and account screens; configured-method parity, provider callbacks
and local fallback. Its existing raw resident-code cookie and local JWT lifecycle
are not that cutover. Do not treat the password primitive import as completion.
Keep role, site and tenant authorization in product adapters and verify them on
every request. Review role changes and impersonation across the cutover.

SearchKit and ListKit source/API review confirmed applicability. The AOZ package
plan names current SQL substring searches, name filters and URL/filter codecs;
migrations remain open. Preserve site/role restrictions before matching, exact
code lookup semantics, saved group defaults and neutral overrides. Add the
shared generated typo suite when migrating searches.

Authenticated production date/account/private-message journeys remain open.
The user named Revamp-It and Evig as approved contexts for tenant journeys;
this does not supply test credentials or approve exposing tenant records.
The prior resume file was not present in the fresh execution workspace or
found on the current Fleet default branch. This checkpoint records only the
evidence collected here.

Every other repository's open criteria remain in the checklist: Vitareba #129,
Hirnli #148/#130, Substrata #184, Kivvi German charts/#125, Petvity charts/#106,
Evig chart/instruction review, Surf Your Life #87/provider parity, the closed
AccountKit PR replacements, wider Loki/OrangeCat/DataCat account journeys,
Bitbaum #119/#123/#103, all remaining apps and package producers, ten current
instruction findings, full security census and unattended release/recovery
proof. None was closed by the two changes above.

## Execution access interruption and audit coverage

The source census enumerated 61 active original repositories and captured
immutable source for 42. Nineteen remained unavailable after a bounded retry;
they must not count as audited. The local capture is evidence of manifests,
locks and candidate imports only, not applicability or working integration.
The active OpenClaw fork is separate from this original-repository census and
is not cleared by its exclusion. Private source snapshots remain in the execution
workspace and are not published with this checkpoint.

A fresh instruction-file scan completed after one GitHub 503 retry: 46 public
code repositories, the same ten findings, no new finding. Every recorded
baseline line remains. Private repositories and additional editor files still
need coverage.

Subsequent Git/CLI requests consistently failed with HTTP 503 and an upstream
`envoy://cloudflare_https_tunnel/` connection failure. Fetch/clone retries did
not recover the path. Environment status still reported enforced unrestricted
HTTP policy and no retained diagnostic captures; that is not proof of network
health. Connected GitHub tools remained usable and were used to read PR status
and preserve this checkpoint. Git clone/fetch/push and CLI orchestration remain blocked. Independent read-only
probes still returned HTTP 200 for npm and AOZ; do not describe all egress or
public-app access as unavailable. Connected tools and local checks remain usable.

Revamp-It and Evig are the approved tenant contexts named by the user. An
approved AOZ production test identity and an authenticated runtime/database
connection have been requested; neither is available in this execution context.
Do not infer working providers or send account mail to guessed identities.
