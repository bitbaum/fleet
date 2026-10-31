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

## Auth migrations shipped; agent-file findings closed (2026-10-29, afternoon)

AccountKit released 0.14.0 with `plugins` (#45) and `site.trustedOrigins`
(#46). `site.trustedOrigins` accepts a list, or a lookup for hosts kept as
data.

- **Hirnli** ([#151](https://github.com/bitbaum/hirnli/pull/151)) is on
  AccountKit, with `organization()` mounted. Tenant origins come from
  `org_domains`. Checks against the live site: a tenant-host sign-in passes the
  origin check (401 on bad credentials, 403 before the deploy), and a foreign
  origin is still 403. #148 was closed as superseded.
- **Substrata** ([#294](https://github.com/bitbaum/substrata/pull/294)) is on
  AccountKit, keeping OrangeCat actor ids through `legacyIdentityProvider`, and
  `017-accounts.sql` is applied by the deploy. `/sign-in`, `/sign-up` and
  `/account` are live. OrangeCat accepts the authorize request, which still
  returns to the original `/api/auth/callback/orangecat`. The extra URI from
  orangecat #1471 is unused but harmless.
- **Vitareba** (#134, #129): both merged on `^0.14.0`. The AccountKit runtime
  is staged with the switch off, and NextAuth still answers. Health and the
  auth pages are fine on the live site.

The rollout gate needs `browser-smoke.yml` on each consumer.
`shared-auth-journey.yml` does not fit an app that has mail off, has
organisations, or is still on NextAuth, so each of these apps now has its own
journey: Hirnli `account`, Vitareba `patient-journey`. A consumer pinned to an
AccountKit version that the canary never deployed waits forever. Move it to
the canary's version.

Agent files: every finding in `scripts/ci/agent-files.baseline` is fixed on
main, so the baseline is empty:
- biaslens #124;
- evig #625;
- kivvi #183;
- loki #1465;
- orangecat #1472;
- petvity #138;
- surf-your-life #118;
- vitareba #135;
- substrata #283.

Docs-only PRs whose branch predated a dependency-floor merge were held by the
rollout gate until main was merged in.

Follow-ups:
- Loki's profile enrichment still reads `CLAUDE.md`, which is now a pointer
  everywhere. It should read `AGENTS.md`.
- Hirnli has no sign-out button.
- Vitareba: the switch (an approved test identity), and Google-only patients.
- AOZ: the switch, deferred by the owner.

Resume at: the remaining checklist items in order. These are authentication
parity, AI Kit/ChatKit, stale draft PRs, truth dependencies, the security
review, the unattended release proof and the final census.

## Sign-in service, recovery and security review (2026-10-30/31)

- **Shared sign-in service.** [bitbaum/signin#1](https://github.com/bitbaum/signin/pull/1)
  merged: an OIDC provider on AccountKit's runtime with pairwise subjects. It
  ships CI and a browser smoke test on the production build. Loki
  [#1481](https://github.com/bitbaum/loki/pull/1481) registers it (port 4038,
  its own `signin` database, status `prospect`), and `app-secrets.sh` can now
  write one generated value into two apps (`pair:`). Fleet #383 adds the
  STACK.md entry.
  - **Not live.** The owner steps are on the owner checklist page (below); the
    box has no database or env for `signin` yet, so every deploy fails until
    they are done.
  - **New-repo traps found:** fleet #384 (seed `auto-merge.yml` on `main`) and
    #386 (a shared-package consumer also needs `browser-smoke.yml`).
- **Rollout gate.** Fleet [#391](https://github.com/bitbaum/fleet/pull/391)
  fixes a deadlock: the gate measured a PR from GitHub's recorded base rather
  than its merge base, so a stale branch read as a package downgrade and was
  held for a version no canary would ever run again.
- **Recovery mail.** Diplodoctor #59, Solon #337 and Heidi #252 merged. Recovery
  appears once `RESEND_API_KEY` reaches each app on the box (owner step 2).
- **Security review.** The census, the PRs that landed, and what is still open
  or excepted are recorded under the checklist item (fleet #390). OrangeCat
  #1491 has since merged. Still open there: the derhochhinhouse refresh #3
  (waits on #5, its CI, which needs the owner's first merge), and the Loki AppImage
  `--no-sandbox` flag (a follow-up, tested on a packaged build).
- **Owner checklist.** All owner-only steps (links, commands and checks) are on
  the private page https://claude.ai/artifact/LxATXnTgyCwRGxp4nf4oyX:
  1. sign-in go-live;
  2. recovery mail;
  3. the refresh repo;
  4. the Kivvi key seal;
  5. the Surf `session_preps` grant (`pnpm db:migrate` already ran on deploy);
  6. the Kivvi terms sentence;
  7. Loki's Google and X consoles;
  8. the Substrata outage logs;
  9. the Morulia questions.
- **orangecat-2 is out of scope** at the owner's instruction. It is a Loki
  starter, not OrangeCat; the security PR there (#5) was closed unmerged. Do not
  open work in it.
- **Assistant follow-ups waiting on the owner:**
  - the apps.conf `prospect` → `live` PR for `signin`, after go-live steps 1–5;
  - unpausing Loki's Google and X once the consoles are fixed;
  - Kivvi terms option 1 or 2;
  - CI for the refresh repo, if kept;
  - a `trustedOrigins` entry for Apple if Apple sign-in fails.

Resume at, in checklist order:
1. NextAuth → AccountKit for evig, kivvi, loki, petvity and surf-your-life, one
   app at a time;
2. AI Kit / ChatKit;
3. truth dependencies and package pages;
4. the unattended release proof;
5. the final census.

## Owner steps done by the assistant (2026-10-31, evening)

The owner asked that every step not needing their own accounts be done
without them.

- **Sign-in service is live** at https://signin.orangecat.ch (port 4040, row
  `live`). Health reports db up and 7 registered clients, and discovery names
  the issuer. No providers are configured yet, and no consuming app has
  `SIGNIN_ISSUER` / `SIGNIN_CLIENT_ID`; both wait on the owner's provider
  credentials. Loki PRs:
  - #1487: `provision-db.yml`, an app's database without a laptop;
  - #1489: a failing wake socket says why;
  - #1490: the live row;
  - #1491: stop a leftover wake proxy before a site's first switch to sleeping;
  - #1492: BiasLens 4038 and keller 4039 entered from the box, signin moved to
    4040.

  #1493 adds a daily register-drift check. Main had not known BiasLens's port,
  because #1404 never merged, so signin was first given 4038 and its address
  served BiasLens.
- **Recovery mail is on** for Diplodoctor, Solon and Heidi. Loki #1488: an
  empty line in an app's `.env` no longer erases a fleet key, and
  `FLEET_KEYS_OFF` turns one off on purpose. Solon and Heidi needed a redeploy,
  because a sync does not restart always-on apps. No real reset has been sent
  yet.
- **Kivvi:**
  - #199 removes the dead Terms sentence;
  - #200 seals plaintext company AI keys at server start;
  - #201 fixes a real sign-out race: a prefetch re-issued the session cookie
    after sign-out.

  The box's seal counts are only in `journalctl -u kivvi-app`.
- **Surf Your Life #132:** the `session_preps` grant is applied through a
  migration, and the deploy log confirms that the role reads every table.
- **Refresh repo:** #5 adds CI. Its first merge needs the owner, because the
  sweep runs from `auto-merge.yml` on main. Security PR #3 then merges itself.
- **Morulia Q1** was decided in fleet #398: a sibling life's review is always
  marked "same person".

Still the owner's:
- provider credentials for signin, then the two env lines per consuming app;
- Loki's Google and X consoles;
- the first merge of the refresh repo's #5;
- the Substrata outage logs;
- Morulia Q2 and Q3;
- one real password reset on each of the three apps.
