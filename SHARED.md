# Shared code across the fleet

**Before you build something, check this file. If it is here, install it.**

This exists because the alternative was tried and measurably failed. Every
duplication in this fleet was already known, and knowing changed nothing:

- orangecat's `ADR-0002-rate-limiting-unification.md` (2026-01-18) sat at
  **Status: Proposed** for seven months. It named *two* implementations; the
  count reached **four** before it was finally resolved in-repo (Accepted
  2026-08-25 — one canonical module, and almost none of the original plan
  survived contact).
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
| [`ai-forms`](https://github.com/bitbaum/ai-forms) | `"@fleet/ai-forms": "github:bitbaum/ai-forms#v0.1.2"` in `dependencies` (the alias every consumer uses) | per-app "fill this form from prose" + conversational refinement. Headless — ships **no markup**, so each app keeps its own styling. |
| [`ai-kit`](https://github.com/bitbaum/ai-kit) | `pnpm add @bitbaum/ai-kit` (on npm since 2026-09-04) | **the AI layer, in one install** — which model to call, whether the vendor still lists it, how to walk the fallback chain and know when none of it worked (`tryChain`/`createHealthTracker`, v0.5.0), the three kinds of 429, fair-share of a free tier, and (re-exported) `ai-forms`. Renamed from `ai-ration` 2026-08-26: the name described one of five modules, and the package had one adopter while five repos that skipped it went down together to a retired model id. |
| [`threadkit`](https://github.com/bitbaum/threadkit) | `pnpm add threadkit` | multi-participant message threads where *permission is participation*, not a role or an ownership column. Headless pure functions, so "who may read this" is unit-testable instead of buried in a `WHERE` clause. AI participants obey the same visibility rules. **ESM-only.** |
| [`sitekit`](https://github.com/bitbaum/sitekit) | `pnpm add github:bitbaum/sitekit#v0.3.0` | **a website as data** — the closed section union (Zod as SSOT, path-addressed errors a generator can act on), one set of React renderers emitting semantic classes only (tokens stay per-site: uniform system, divergent aesthetics), and per-field provenance (`scraped`/`operator`/`inferred`/`not-found`) so `assertDeliverable()` makes "we fabricate no facts" a check instead of a promise. Extracted from substrata per orangecat ADR-0003; the planned `siteFromUrl()` extractor targets this schema. RSC-native — the Link seam stays a server-component prop (learned in v0.1.1 when the first consumer's build refused a component function crossing 'use client'). **ESM-only.** |
| [`limitkit`](https://github.com/bitbaum/limitkit) | `pnpm add github:bitbaum/limitkit#v0.2.0` | the fleet's **12 hand-rolled rate limiters** (this file's own "next extraction" row). Sliding/fixed windows over an injectable two-method `Store`; **bounded** memory default (the unbounded-Map leak is impossible by construction); standard `X-RateLimit-*` + `Retry-After` headers — what orangecat's ADR-0002 specified seven months before anything enforced it; `clientIp()`. Refusals count nothing, so a hammered key recovers. Ships no middleware and **no limit values** — how many attempts a route allows is app semantics, asserted locally. |

**Adopted:** `ai-forms` — fleetcrown, evig, aoz-housing, surf-your-life, kivvi.
`ai-kit` — fleetcrown, aoz-housing, truthseeker, botsmann, evig, orangecat,
hirnli (all seven on `@bitbaum/ai-kit` from npm), surf-your-life and kivvi's
`@kivvi/ai` (both still via git tag — convert when touched), **and this repo**
(`model-pin-audit.mjs` calls `checkCatalog`; the audit needed exactly the vendor
query the package owns, so writing a second one here would have been this file's
own sin).

**"Adopted" was overstating it for botsmann, specifically.** A fleet-wide
AI-tooling audit on 2026-08-29 found botsmann had `ai-kit` installed for
`freeChain`/`providerModels` (the model list) only — its actual retry and
health logic (`generateWithBestProvider`, `getProviderChain`, an in-process
`llm-health.ts`) was hand-rolled, the same shape this file exists to prevent,
just one repo instead of five. That hand-rolled code is exactly what
`tryChain`/`createHealthTracker` (v0.5.0) were extracted FROM, and botsmann
was converted the same day as the proving consumer — walk one flat
provider+model chain instead of two nested hand-rolled loops, and the health
tracker now wraps `createHealthTracker` behind its original five-function API.
**`tryChain`/`createHealthTracker` are new in v0.5.0 and had TWO real
adopters (botsmann, hirnli) as of 2026-08-29** — fleetcrown/aoz-housing/
truthseeker are on `^0.6.2` now but do not use either function yet. Say so
precisely rather than let "ai-kit adopted" imply the failover/health gap is
closed fleet-wide. Since then: evig converted (`tryChain` in
`src/lib/ai/providers.ts`), kivvi wraps `createHealthTracker`
(`packages/ai/src/health.ts`), and orangecat installs `@bitbaum/ai-kit` for
its grounding harness while keeping its own model registry.

**hirnli and "revamp-info" were counted as two separate repos in the
2026-08-29 audit. They are not — `git remote -v` in `/home/g/dev/revamp-info`
points at `github.com/bitbaum/hirnli`: same repo, two local checkout
directories, the identical measurement trap this file's own registry
already withdrew an extraction for once (`@ai-native-cms/core`, see below).
`revamp-info` is the `apps.conf` deploy name (hirnli's `deploy.yml` says so
in a comment); the repo is `hirnli`. It is now on `tryChain`/
`createHealthTracker`, same commit as the fix above — there is no separate
"revamp-info" left to convert. Check `git remote -v` before counting a
directory as a repo, every time, including here.

Adoption went 2 -> 5 on 2026-08-27, all of it as a side effect of repairing the
outage rather than as a migration project — which is the only way it has ever
moved here. Three repos deliberately did NOT adopt, and the reason is the same
in each: kivvi, orangecat and evig already own model REGISTRIES carrying context
windows, tool/vision support and per-token cost, which `ai-kit` does not model.
Installing it beside one of those adds a second source of model truth to a repo
whose problem was having two. They were repaired in place and left pointing at
the daily audit instead. Merging a registry into `ai-kit` is a real design
question and belongs to a human, not to an outage. (All three have since
adopted anyway, each on its own terms — see the paragraph above.)

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
never by "these are all shared utilities". `threadkit` — **vitareba**
(`^0.1.1`, driving its care-team messaging in `lib/domain/messages.ts` — the
exact clinic case it was extracted for).
`limitkit` — fleetcrown (proving consumer; its old limiter had the unbounded
Map). orangecat closed its ADR-0002 in-repo instead (Accepted 2026-08-25: one
canonical `src/lib/rate-limit.ts`, the messaging duplicate deleted) — so the
next limitkit adopter is whichever repo's hand-rolled limiter is touched next.
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
first multilingual PROSPECT instead, the way camille grew it. wild-spirit is NOT a straight
conversion: it is a hand-rolled no-framework static generator (`src/build.mjs`)
that independently reinvented site-as-data, so adopting sitekit there is a
port decision, not a refactor — decide deliberately, don't drift into it.
**Not yet:** orangecat still carries its own form-assist; kivvi's provider
layer wraps ai-kit rather than using it directly, and still pins the old git
tag (`#v0.5.0`).

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
| ~~`vitareba`~~ | **adopted** — care-team messaging runs on it (`lib/domain/messages.ts`) |
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
| `scripts/ci/hosted-supabase-audit.sh` | does any repo still point at a Supabase we retired? The fleet self-hosts on bitbaum; two managed-cloud projects are dead. botsmann kept a setup doc opening with "Completed Setup" for one of them, telling you to apply migrations by pasting SQL into a dashboard that does not exist for us — so nobody pasted anything, its eleven migrations were never applied, and `/api/health` served PGRST205 for months while every deploy went green. The docs were not stale clutter; they were the outage. Allows `supabase.com/docs` (the product documentation is still correct) and `your-project.supabase.co` (a placeholder misleads nobody) — a gate that fires on those gets muted. Legitimate mentions, like a decommission runbook naming what it decommissioned, live in `hosted-supabase.baseline` **with a reason**: a ratchet that may fall or hold, never rise. GitHub code search returns nothing for these repos, so the workflow shallow-clones the fleet and runs the same script — and says SKIPPED, loudly, when it sweeps nothing, because a vacuous pass reads exactly like coverage. Self-tested by `scripts/ci/test-hosted-supabase-audit.sh` — **28 checks, no network, no checkout**, pinning both sides. |

Both report into a weekly workflow's job summary rather than only a log.

## What is worth extracting next

Ranked by (copies × how identical the logic is). Counts from
`scripts/ci/shared-inventory.sh`, forks excluded.

| Concern | Files | Why it is a good candidate |
|---|---|---|
| `auto-merge-sweep.sh` | ~~22~~ **6** | **EXTRACTED 2026-08-16/20.** Most repos call the canonical as a reusable workflow, each verified to actually *run* it (a sweep that fails to start looks exactly like one with nothing to do). The remaining copies: **this repo** is the canonical home (moved here from dotfiles 2026-08-28; dotfiles has since dropped its copy, and ai-forms converted to the reusable workflow); datacat, petvity, solon still run local copies — had dirty working trees owned by other sessions when swept, convert when clear. The two repos that had ever *tested* their copies (evig, orangecat) had that coverage ported into the canonical suite **before** deletion: 17 cases, mutation-proven. |
| rate limiting | **14 → adopting** | **Extracted 2026-08-20 as [`limitkit`](https://github.com/bitbaum/limitkit)** (see registry above). fleetcrown converted as the proving consumer; orangecat instead unified in-repo (ADR-0002 Accepted 2026-08-25, one canonical module) without limitkit. The remaining hand-rolled limiters convert as touched; the ratchet holds the count until each adoption lands. |
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
- **Navigation chrome.** Measured 2026-08-29: ~13,300 lines of nav across 20
  repos, and the experiment has already been run. `sitekit` is the one shared
  renderer, it serves 2 of 20, and it shipped two defects — ~28px targets and
  no focus style — to **both** consumers, unfixable downstream because a
  consumer cannot patch markup it does not own. Its nav model (a flat
  `{path, label}` list, no groups, no icons, no footer links, no mobile menu)
  also cannot express what solon's mega-menu or reparaturbonus-zh's drawer
  need, which is why every repo with real nav complexity reinvented its own
  rather than adopt it. Centralizing the markup centralized the bug.
  The navigation **contract** below is the shareable part.

---

## The navigation contract

Six rules, each one a defect found in the 2026-08-29 audit, each mechanically
checkable. This is the nav answer to "centralize the rule, assert it locally".

1. The active link of every nav surface carries `aria-current`.
2. Every toggle controlling a panel carries `aria-expanded`.
3. Every interactive nav element is at least 44×44px.
4. The label lives **inside** the control, never beside it.
5. Persisted UI state distinguishes `null` from empty.
6. Every internal href comes from a routes constant.

**Enforced in three places, because they cover disjoint surfaces.**
`scripts/ci/ui-defect-audit.mjs` checks 1, 3 and 4 by **rendering** each live
site — which is the only thing that spans Next apps, CSS modules, Tailwind and
wild-spirit's no-framework generator alike. But it renders **public entry pages
only**, so it structurally cannot see a sidebar behind a login. `nav-contract.yml`
/ `scripts/ci/nav-contract-audit.sh` closes exactly that gap for rule 1: a
weekly, central, source-level sweep of every repo's default branch (public and
authed alike), self-tested before it runs. It found and fixed six repos —
botsmann, datacat, petvity, printcraft, s-ink, surf-your-life — on its first
sweep, 2026-08-31. A per-repo `verify` check can still be worth adding
alongside it: orangecat's `check:dead-labels` (rule 4) and fleetcrown's
`check_paired` in `check-design-system.sh` (rule 1) block the *commit*,
where the fleet sweep only reports weekly.

**Open gap the central sweeps share: `orangecat.ch` isn't the whole fleet.**
`ui-defect-audit.mjs` discovers sites from `FLEET_SITES` in fleetcrown's
public footer — a deliberately hand-maintained editorial list, "each site's
own words," not something to auto-expand. As of 2026-08-31 four public sites
are outside it: s-ink (sinktattoo.com, genuinely off the `orangecat.ch`
pattern) and substrata / camille-boulangerie / wild-spirit (all on
`*.orangecat.ch`, but not yet linked from the footer that drives discovery).
`nav-contract-audit.sh` still sees all four, because it reads source rather
than a curated link list. Adding the missing three to `FLEET_SITES` is a
one-line-each product decision for a human, not folded into this sweep.

**Deliberately NOT on the ratchet.** The ratchet counts concerns that should
converge on ONE implementation, and nav is the opposite: every repo is supposed
to have its own nav config, so counting those files would score the correct
outcome as duplication and the number would have no meaning. The contract is
enforced by the gates above instead. (This revises the audit's own first
recommendation — writing the "do not centralize" section above is what showed
the two could not both be right.)

**Why a gate and not a convention.** The audit's sharpest finding was not that
teams do not know these rules — it is that aoz-housing, fleetcrown, vitareba
and evig each applied `aria-current` correctly on every nav surface **but one**.
Four teams, four stragglers. Hand-application always fails at the margin, and
the margin is invisible until someone renders it. Design tokens are the control
group: near-spotless fleet-wide, because they got a convention **plus a gate**
(`check:accent-ink`) rather than a shared component library.

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
