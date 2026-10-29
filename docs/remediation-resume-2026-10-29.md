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
  AOZ has not yet adopted this release or completed its data migration.

## Active prerequisite and remaining AOZ acceptance

AccountKit's local `fix/domain-credential-runtime` branch is under development.
It is not published and must not be counted as adoption. It adapts product-owned
code proof to shared revocable sessions, binds product identity restrictions
before exposing a session, and refuses code-only account-security changes and
MFA bypass. Finish its database regressions, full verification and checked
release before consuming it. Preserve the narrower identity of a code login:
a staff code must not silently become access to a linked resident identity,
nor may it enroll credentials for the whole account.

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
