# Remediation checkpoint — 2026-10-29

Continuation evidence: [AOZ migration staging](#accountkit-staging-continuation),
[AOZ shared runtime](#aoz-shared-runtime-continuation).

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

The next AOZ cutover was prepared in a separate local worktree
(`/workspace/aoz-auth`, branch `fix/accountkit-runtime`, starting at
`80db2f7bdbf71adef237683679dfef4b4470d85b`). Installing AccountKit 0.10.0
and its Better Auth/passkey peers then received repeated HTTP 503 responses for
package metadata and tarballs. The retry loop was stopped; the worktree's
manifest and lockfile remained unchanged. No auth schema/data migration or
cutover was published. Restore reliable package/GitHub retrieval, reconcile the
current default branch and currency PRs, then implement and rehearse the full
identity-preserving migration before release. The fresh auth worktree is a
starting point, not completed implementation.

## AccountKit staging continuation

Git clone/fetch/push and npm access recovered in the following execution. The
fresh workspace contained no prior worktree or running install. AOZ was cloned
at current master `2d9b0d3539d7ba0f43e91431d4329e431bf6a13e`, which already
contains the AccountKit 0.10.0 floor, and a frozen dependency install completed.

AOZ [#340](https://github.com/bitbaum/aoz-begleitung/pull/340), head
`7299d3a083ba8842dbe8e6dc6f76824ec6982079`, stages the published shared tables,
an explicit shared-user to staff/resident mapping, and a rollback-only importer.
It preserves Account ids, both actor ids and bcrypt hashes, retains unclaimed
invited accounts, creates namespaced identities for code-only actors, refuses
conflicting ownership and changed shared credentials, and never mutates the
legacy records. Deployment of this change would create empty tables only; the
data importer is outside automatic migrations and its CLI has no apply mode.

Full local verify passed 288 files / 4,590 tests, with ten existing lint warnings
and no errors. Production build passed using the repository's dummy CI build
configuration; Drizzle consistency and documentation truth audits passed. Seven
database tests apply the entire committed schema chain in PostgreSQL/PGlite,
exercise both hash formats through the actual AccountKit runtime, and prove
transaction rollback, conflict rejection, reset/session revocation and one-time
reset tokens. The dependency audit still reports zero high/critical advisories
and the existing moderate development esbuild advisory. Hosted CI, sweep merge
and deployment are not certified by these local results.

The tests exposed a specific compatibility condition: with mail configured,
AccountKit requires email verification for an imported unverified account;
AOZ's old password login does not. The importer preserves the verification
flag. Prove a usable verification/recovery journey before cutover rather than
marking the account verified without proof. Shared first-password provisioning
for invited/code-only accounts, second-identity linking with existing-account
proof, runtime session/authorization and impersonation adapters, account screens,
configured-provider journeys and deployed proof all remain open. The approved
AOZ production test identity and authenticated database/runtime access remain
unavailable in this execution. No production credentials were imported and the
served auth lifecycle was not switched.

AOZ #338 was refreshed by merging current master into its branch, without
rewriting history, at `2f4cbf3589981104478b890fe4572f438a1ec2d9`. Its frozen
install and three focused search/selection tests passed. The earlier sweep run
`40826317733` held its old head because the old AccountKit 0.9.1 artifact lacked
canary rollout evidence. Hosted checks are rerunning against the refreshed
0.10.0 lockfile. Do not treat the old green checks or this branch refresh as
merge, deployment or complete search/list adoption evidence.

Resume at AOZ #340's hosted checks and the runtime prerequisites in its migration
guide, and #338's refreshed checks/sweep outcome. The rest of this checkpoint's
application and fleet acceptance queue remains open.

## AOZ shared runtime continuation

AOZ #340 and #338 merged and deployed. AccountKit released two prerequisites,
each published with provenance: 0.11.0 (#42) adds the shared first-password
claim with proof-gated linking, and makes a used reset link verify its address.
0.12.0 (#43) adds a per-person session idle limit.

AOZ [#342](https://github.com/bitbaum/aoz-begleitung/pull/342) merged the
shared runtime behind `AUTH_RUNTIME=accountkit`, which no deployment sets. It
covers code login scoped to its side, row-reloaded authorization, claims and
linking, read-only borrowed views and the existing screens served through a
bridge. AOZ [#344](https://github.com/bitbaum/aoz-begleitung/pull/344) keeps
staff sessions at 8 hours, as the owner decided on 2026-10-29. Database tests
run on the migration chain plus the real import SQL. No deployed or browser
evidence exists for the runtime, and no account data was imported.

The owner deferred the switch. The open AOZ auth item is the locked import plus
switching both settings together, which needs an approved test identity. AOZ's
other open blocks remain: staff SQL searches (SearchKit), URL/filter codecs
(ListKit), and a review of its local layout primitives.

Resume at AOZ search/lists, then the Vitareba, Hirnli and Substrata auth
migrations, reusing AccountKit's provisioning and `sessionLifetime`. The
remaining checklist items are unchanged.

## Auth migrations across the queue (2026-10-29, later)

AOZ: [#346](https://github.com/bitbaum/aoz-begleitung/pull/346) merged the
staff searches onto SearchKit (`searchText`, which only narrows rows already
authorised). ListKit stays a recorded exception in `package-plan.json`: it has
no viewer-relative defaults or neutral overrides. Only the switch remains
open, still deferred by the owner.

AccountKit released 0.13.0, which adds `createAuthTables(prefix)` for products
whose own tables already use the standard names. #45 merged `plugins`, for a
product's own better-auth plugins such as `organization`.
[#46](https://github.com/bitbaum/accountkit/pull/46) adds
`site.trustedOrigins`, as a list or as a lookup for hosts kept as data. 0.14.0
follows once it merges.

Vitareba: [#134](https://github.com/bitbaum/vitareba/pull/134) stages the
`auth_*` tables beside NextAuth and adds a rollback-only import rehearsal. It
also wires the runtime behind `AUTH_RUNTIME=accountkit` (off), with
`next-auth/react` answered by AccountKit. It is green and waits for the sweep.
Known gap: Google-only patients (AccountKit has no Google provider).

Hirnli: [#151](https://github.com/bitbaum/hirnli/pull/151) (draft until
0.14.0) moves sign-in onto AccountKit's runtime with `organization()` mounted.
Tenant hosts come from `org_domains`. Hashes and session cookies stay valid,
and additive migration 0018 is part of it. Account mail stays off, because
every existing account is unverified. It supersedes #148's password rule.

Substrata: Substrata's deploy now applies `scripts/db/*.sql` itself, so #184's
blocker is gone. #184 is being rebuilt on current main as a new PR.

Resume at: AccountKit 0.14.0, then Hirnli #151 ready, then Substrata's new
PR, then the remaining apps in checklist order.
