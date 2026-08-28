# Shared code across the fleet

**Before you build something, check this file. If it is here, install it.**

This exists because the alternative was tried and measurably failed. Every
duplication in this fleet was already known, and knowing changed nothing:

- orangecat's `ADR-0002-rate-limiting-unification.md` (2026-01-18) is still
  **Status: Proposed**. It names *two* implementations. There are now **four**.
- `templates/ci/README.md` says "deliberately ONE central script, not a copy per
  repo". `auto-merge-sweep.sh` lives in **22 repos**, and as of 2026-08-16 in
  **8 distinct versions** spanning 11,787–19,344 bytes. A fix landed in one
  reaches at most 9 of them.

Both were written down. Writing it down is what failed. So this file is short,
the inventory underneath it is **generated**, and the number it produces is a
**ratchet** — see "The process" below.

---

## The registry — what already exists

| Package | Install | Replaces |
|---|---|---|
| [`ai-forms`](https://github.com/bitbaum/ai-forms) | `npm i github:bitbaum/ai-forms#v0.1.0` | per-app "fill this form from prose" + conversational refinement. Headless — ships **no markup**, so each app keeps its own styling. |
| [`ai-kit`](https://github.com/bitbaum/ai-kit) | `npm i github:bitbaum/ai-kit#v0.4.0` | **the AI layer, in one install** — which model to call, whether the vendor still lists it, the three kinds of 429, fair-share of a free tier, and (re-exported) `ai-forms`. Renamed from `ai-ration` 2026-08-26: the name described one of five modules, and the package had one adopter while five repos that skipped it went down together to a retired model id. |
| [`threadkit`](https://github.com/bitbaum/threadkit) | `npm i threadkit` | multi-participant message threads where *permission is participation*, not a role or an ownership column. Headless pure functions, so "who may read this" is unit-testable instead of buried in a `WHERE` clause. AI participants obey the same visibility rules. **ESM-only.** |
| [`sitekit`](https://github.com/bitbaum/sitekit) | `npm i github:bitbaum/sitekit#v0.2.0` | **a website as data** — the closed section union (Zod as SSOT, path-addressed errors a generator can act on), one set of React renderers emitting semantic classes only (tokens stay per-site: uniform system, divergent aesthetics), and per-field provenance (`scraped`/`operator`/`inferred`/`not-found`) so `assertDeliverable()` makes "we fabricate no facts" a check instead of a promise. Extracted from substrata per orangecat ADR-0003; the planned `siteFromUrl()` extractor targets this schema. RSC-native — the Link seam stays a server-component prop (learned in v0.1.1 when the first consumer's build refused a component function crossing 'use client'). **ESM-only.** |
| [`limitkit`](https://github.com/bitbaum/limitkit) | `npm i github:bitbaum/limitkit#v0.1.0` | the fleet's **12 hand-rolled rate limiters** (this file's own "next extraction" row). Sliding/fixed windows over an injectable two-method `Store`; **bounded** memory default (the unbounded-Map leak is impossible by construction); standard `X-RateLimit-*` + `Retry-After` headers — what orangecat's ADR-0002 specified seven months before anything enforced it; `clientIp()`. Refusals count nothing, so a hammered key recovers. Ships no middleware and **no limit values** — how many attempts a route allows is app semantics, asserted locally. |

**Adopted:** `ai-forms` — fleetcrown, evig, aoz-housing, surf-your-life.
`ai-kit` — fleetcrown, aoz-housing, truthseeker, botsmann, **and this repo**
(`model-pin-audit.mjs` calls `checkCatalog`; the audit needed exactly the vendor
query the package owns, so writing a second one here would have been this file's
own sin).

Adoption went 2 -> 5 on 2026-08-27, all of it as a side effect of repairing the
outage rather than as a migration project — which is the only way it has ever
moved here. Three repos deliberately did NOT adopt, and the reason is the same
in each: kivvi, orangecat and evig already own model REGISTRIES carrying context
windows, tool/vision support and per-token cost, which `ai-kit` does not model.
Installing it beside one of those adds a second source of model truth to a repo
whose problem was having two. They were repaired in place and left pointing at
the daily audit instead. Merging a registry into `ai-kit` is a real design
question and belongs to a human, not to an outage.

**v0.4.0 is breaking:** form filling moved off the root export to `ai-kit/forms`.
One install, one version, one import path per concern — the root re-export made
a chain-only consumer load `ai-forms` (ESM-only) and broke AOZ's Jest run inside
a module it never imported. Fixed in the package rather than with a
`transformIgnorePatterns` line per adopter.

**On merging packages.** `ai-kit` absorbed `ai-ration` and re-exports
`ai-forms`, because to an app "which model do we call", "AI chat" and "AI form
fill" are ONE feature — AOZ adopted the form half, hand-rolled the rest, and was
taken down by the half it skipped. `threadkit` and `limitkit` are deliberately
NOT merged in: neither is about AI, and an app throttling its login form should
not install a model catalogue to do it. Merge by what a consumer needs together,
never by "these are all shared utilities". `threadkit` — **nobody yet**.
`limitkit` — fleetcrown (proving consumer; its old limiter had the unbounded
Map). **Next adopter should be orangecat** — it closes ADR-0002 by making its
Upstash client a 12-line `Store` adapter and deleting three of its four
implementations.
`sitekit` — substrata (proving consumer, converted the day the package
shipped: −577 lines of local renderer, and its test now validates the whole
site against the shared schema, so a breaking schema change fails in the
consumer's CI first) **and camille-boulangerie** (merged + live 2026-08-28;
its rebuild forced `feature`/`contact`/`faq`/hero-actions/card-icons into
v0.2.0 — the union grows only when a real site cannot be expressed).
**s-ink: assessed and deliberately NOT adopted** — it is a current Next
16.3 app with seven-locale `app/[locale]` routing, a works gallery and an
enquiry API; sitekit has no locale concept or gallery kind, so adoption
would regress a real client's live site for nothing. Grow the union on the
first multilingual PROSPECT instead, the way camille grew it. **Next: camille-boulangerie
(PR open — it forced `feature`/`contact`/`faq`/hero-actions into v0.2.0), then
s-ink (sinktattoo.com)** — real sites make the union's gaps visible on sites we
own before the schema is pointed at strangers. wild-spirit is NOT a straight
conversion: it is a hand-rolled no-framework static generator (`src/build.mjs`)
that independently reinvented site-as-data, so adopting sitekit there is a
port decision, not a refactor — decide deliberately, don't drift into it.
**Not yet:** orangecat and kivvi still carry their own form-assist; kivvi, evig,
botsmann still carry their own provider layers.

A package with zero adopters removes zero duplication — publishing is the
cheap half. `threadkit` is listed here on its first day precisely so it does
not become another extraction nobody wired up.

**`threadkit` shipped 2026-08-16** — `v0.1.0` on the public registry, published
by the tagged workflow with an SLSA provenance attestation, so the registry can
prove which commit built the tarball. Verified from outside the fleet, not from
CI: installed from the public registry into an empty project, imported, and got
17 named exports plus `dist/index.d.ts`.

It exists because of the bug
[`single-tenant-prod-hides-unscoped-queries`](https://github.com/bitbaum/dotfiles)
records: role-derived access is correct at one doctor / one tenant / one org and
silently wrong at two. `canRead(thread, user)` cannot express that bug, because
there is no role to check.

**Adoption candidates, in order of how much duplicated code it removes:**

| Repo | What it replaces there |
|---|---|
| `vitareba` | care-team messaging — the exact clinic case: threads whose reader set is "the care team", not "the patient's doctor" |
| `orangecat` | Cat DMs / conversation visibility |
| `fleetcrown` | agent↔human threads, where an AI participant already needs the same rules as a person |

**ESM-only** (`"type": "module"`, no `require` condition), so a CJS consumer
cannot `require()` it. Every candidate above is ESM already; note it before
adopting anywhere that is not.

### Central audits — one script, never a copy per repo

Not installable packages: these run FROM this repo against every other one, so
there is nothing to adopt and nothing to drift. Check here before writing a
fleet-wide checker.

| Script | Answers |
|---|---|
| `scripts/ci/verify-floor-audit.sh` | does every repo's `verify` actually run lint + typecheck + test? |
| `scripts/ci/model-pin-audit.mjs` | is any model id the fleet pins no longer served by its vendor? Zero tokens — one `GET /models` per vendor — so it runs DAILY. Uses `ai-kit`'s `checkCatalog` rather than a second vendor query. Self-tested by `scripts/ci/test-model-pin-audit.mjs` — **102 checks, no network, no key, no checkout**, every fixture the real code that fooled it. Using it to repair seven repos on 2026-08-27 exposed nine faults in both directions, and the blind spots were not random: they mirrored the shapes people write (`GROQ_MODELS = {` defeats `\bmodels?\b`; `models: AIModel[] = [` defeats an array pattern; `modelId` is not `model`). It also read ids out of COMMENTS — reporting a retired id in the very commit that removed it. Never trust its first clean run after widening; re-run the live sweep and read every line. |
| `scripts/ci/ui-defect-audit.mjs` | do any live sites ship an interactive label below its WCAG AA floor, or a stack whose rows start at different x? Renders each site; no repo checkout involved. Self-tested by `scripts/ci/test-ui-defect-audit.mjs`, which pins BOTH sides — the real defect is still caught, correct markup stays silent. |

Both report into a weekly workflow's job summary rather than only a log.

## What is worth extracting next

Ranked by (copies × how identical the logic is). Counts from
`scripts/ci/shared-inventory.sh`, forks excluded.

| Concern | Files | Why it is a good candidate |
|---|---|---|
| `auto-merge-sweep.sh` | ~~22~~ **6** | **EXTRACTED 2026-08-16/20.** Sixteen repos call the canonical as a reusable workflow, each verified to actually *run* it (a sweep that fails to start looks exactly like one with nothing to do). The six remaining are deliberate: dotfiles is the canonical home and runs it directly; ai-forms, datacat, petvity, solon had dirty working trees owned by other sessions when swept — convert when clear. The two repos that had ever *tested* their copies (evig, orangecat) had that coverage ported into the canonical suite **before** deletion: 17 cases, mutation-proven. |
| rate limiting | **14 → adopting** | **Extracted 2026-08-20 as [`limitkit`](https://github.com/bitbaum/limitkit)** (see registry above). fleetcrown converted as the proving consumer; 13 files remain across 8 repos, orangecat first in line (its ADR-0002 becomes a 12-line `Store` adapter + three deletions). The ratchet holds the count until each adoption lands. |
| AI provider client | **16** | evig 7, orangecat 5. `ai-kit` already owns the hard part (chain, 429, budget); these are the callers. **Priced 2026-08-26, re-priced 2026-08-27:** Groq retired the llama-3.x family and the damage was far wider than the first count. Seven repos were broken, not five — the audit could not see two of them — and inside a repo the id was written down **two to four times**. Kivvi took three PRs to remove one retired id: it lived in the provider registry, an app's inline fetch body, the fallback chain, and a client hook's `FALLBACK_MODEL`. Each pass only found the copies the tooling could see. That is the cost of duplication measured rather than argued. fleetcrown, which adopted the package, was unaffected throughout. |
| logger | **10** | sbb-lost-found alone has 4. |
| health route | **8** | Identical shape in 8 repos; a 20-line contract. |
| ~~`@ai-native-cms/core`~~ | — | **Withdrawn — measurement error.** `bitbaum/revampit` *redirects* to `bitbaum/evig` (renamed in the pivot); the "two repos" with byte-identical trees were two clones of ONE repo. Nothing to extract. Two directories are not two repos: check `git remote -v` before reporting cross-repo duplication. |

## What must NOT be centralized

Stated explicitly, because "share everything" is its own failure:

- **Auth / sessions** — coupled to the framework *and* the user schema.
- **DB schemas** — Drizzle vs Prisma vs raw SQL; a shared schema fights every ORM.
- **UI markup for chat and forms** — behaviour is shareable, *markup is not*.
  Each app owns its design tokens and has to keep looking like itself. This is
  why `ai-forms` is headless.
- **Anything where app semantics decide correctness.** orangecat legitimately
  lists paid model ids (BYOK — the user's key, the user's choice) while the same
  id in kivvi's fallback was a bug. Centralize the **rule**; assert it
  **locally**, where the app knows which is which.

---

## The process

**1. Rule of three.** First time, write it. Second time, notice. **Third time is
forbidden** — extract it, or you have chosen to maintain N copies forever.

**2. Check this file before building.** One grep. The cost of not checking is
visible above: 22 copies of one script.

**3. New extraction? Follow the shape that already works.**
Unscoped `ai-*` name · ESM · `dist` built by `prepare` (gitignored) ·
`exports` map · `verify = build && test` · **tests that import the package by
NAME**, not by reaching into `dist/` — otherwise a broken `exports`/`files` map
stays green until the first consumer installs it.

**4. Ship no HTTP client.** Every app has its own calling conventions, retries
and logging. Replacing those is a rewrite, not an adoption. Supply the
decisions; leave the fetch alone. This is why `ai-kit` has no client and
`ai-forms` has no markup.

**5. The ratchet.** `scripts/ci/shared-inventory.sh --check` runs on every PR
here and weekly across the fleet. Duplication counts may **fall**, may **hold**,
and may **never rise**.

```bash
scripts/ci/shared-inventory.sh            # report
scripts/ci/shared-inventory.sh --check    # ratchet — exit 1 if a count rose
scripts/ci/shared-inventory.sh --update   # move the baseline, in a PR, reviewed
```

Nobody has to fix 87 duplicated files today. The only requirement is to stop
adding to them — and when a count *falls*, `--update` locks the win in so it
cannot silently regress.

**Raising the baseline is allowed** — sometimes a copy really is right. It just
has to happen in a PR, where someone sees it, instead of by accident.
