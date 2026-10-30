# The blessed stack

One technology per job, fleet-wide. This file is the SSOT for WHICH
technology each job uses; `scripts/ci/blessed-versions.json` is the SSOT for
which MAJOR of it. Deviating from this table in a new repo, or keeping a
deviation alive in an old one, is a decision a human makes here in a PR — not
something a repo drifts into.

Why this exists: the 2026-09-01 uniformity review found the fleet had drifted
into three ORMs, three test runners, and two auth stacks — none of it chosen,
all of it inherited from whichever template a repo started from. Every extra
technology is a second set of expertise, tooling, upgrade labor, and breakage
classes. George's standing decision (2026-09-01): uniform on the table below.

| Job | Blessed | Documented exceptions |
| --- | --- | --- |
| Framework | Next.js (App Router) | packages/libs: none needed |
| Language | TypeScript (strict) | — |
| Styling | Tailwind CSS | — |
| Validation | zod | — |
| ORM / DB access | **Drizzle ORM** + `pg` driver | orangecat, botsmann: supabase-js (self-hosted Supabase architecture: RLS/auth/PostgREST). loki runner & ivy-portal: better-sqlite3 for embedded local state. |
| Database | Postgres (self-hosted; Supabase where the app is Supabase-native) | loki runner/ivy: SQLite embedded |
| Auth | **Every app owns its accounts** (decided 2026-10-11): **`better-auth` 1.x** on Drizzle + `pg`, offering every method — email + password with verification, magic link via `@bitbaum/mail-kit`, passkeys, TOTP 2FA, the shared bitbaum sign-in (Google, GitHub, X, Meta, Apple) and OrangeCat, both as OIDC. Roles live in the app's own users table. One package: `@bitbaum/accountkit/auth`. See "Identity". | orangecat itself is the identity provider (Supabase Auth). aoz-begleitung (hand-rolled `jose`), botsmann + printcraft (Supabase Auth) pre-date better-auth — migrate on contact, not on a schedule |
| Test runner (apps) | Vitest | loki: bespoke tsx gate scripts (deliberate architecture — each script is a named gate) |
| Test runner (packages) | node:test (zero-dep) | — |
| E2E | Playwright | — |
| Email | `@bitbaum/mail-kit` from npm (Resend over raw fetch; one shared free-tier account, all senders `<app>@fleetcrown.orangecat.ch`; daily canary in this repo's email-canary.yml) | evig: Listmonk stays for bulk/newsletter (self-hosted FOSS) + nodemailer SMTP fallback behind the provider seam; transactional mail is Resend (the 2026-09-02 "Listmonk primary" review predates discovering the prod SMTP cred was DEAD — Login denied, live-probed 2026-09-05). GoTrue (self-hosted Supabase auth) sends via Resend SMTP :587 — SMTP is its only interface |
| i18n | next-intl | — |
| AI | `@bitbaum/ai-kit` from npm (the fleet engine; on npm since 2026-09-04) | forks (openclaw) follow upstream. Git-tag pins: ZERO on default branches since 2026-09-05 (surf-your-life #51, kivvi #76, datacat #248 converted the last three) |
| Forms | react-hook-form (+ ai-forms for AI fill) | — |
| Package manager | pnpm 11 (fleet-wide since 2026-09-04; `packageManager` pinned per repo, corepack) | openclaw follows upstream; kivvi (already-pnpm before the sweep) still pins `pnpm@9` — bump pending |
| Runtime | Node LTS (currently 24), nodesource on the box | openclaw gateway: its own nvm-pinned Node |
| Deploy | push → PR → CI → auto-merge sweep → CD → box (systemd + Caddy) | — |
| Maps & globes | **`@bitbaum/geo-kit/map`: `d3-geo` + `topojson-client`, drawn on Canvas 2D** (an orthographic globe that, zoomed in, is a flat map of a country or a commune); data through `@bitbaum/geo-kit`'s manifests. Why: substrata already shipped its globe on d3-geo, and a map of communes is the same globe zoomed in — no second map stack. Extracted into geo-kit 0.2.0 (2026-10-30) when Solon's commune map, then on MapLibre, needed the same. Canvas 2D rather than WebGL (three.js/globe.gl ~600 KB, MapLibre ~800 KB, cobe draws dots, not countries): 240 filled countries per frame fit a phone's frame budget, and it runs wherever the page runs, so there is no flat fallback to maintain. Tiles/street maps would be MapLibre — no repo needs them (Solon's commune map left it for geo-kit/map). | — |

## Identity (2026-10-11)

**Every app owns its accounts and offers every way in.** A person can register
in one product without any other; nothing is required of them elsewhere first.
Supersedes the 2026-09-11 rule ("our products federate to OrangeCat and keep no
users table"), reversed by the owner on 2026-10-11.

- **Methods.** Email + password (with email verification when mail is
  configured), a magic link sent through `@bitbaum/mail-kit`, passkeys, TOTP
  2FA — all working with no external setup — plus two OIDC buttons, each shown
  only when its env is set and hidden (never broken) otherwise:
  - **the shared bitbaum sign-in** (`SIGNIN_ISSUER`, `SIGNIN_CLIENT_ID`,
    `SIGNIN_CLIENT_SECRET`): one service that holds the Google, GitHub, X,
    Meta and Apple credentials ONCE and speaks OIDC to every app, issuing a
    per-app (pairwise) subject and creating no OrangeCat account. Social
    providers are never configured per app. The service is its own project;
    until it runs, the button is simply absent.
  - **OrangeCat** (`ORANGECAT_OAUTH_CLIENT_ID`, `_SECRET`, optional
    `_ISSUER`): one click for people who already have OrangeCat — one option
    among them, never a requirement.
- **Every type of user, one table.** Customers, helpers/assistants,
  professionals, staff and admins are roles in the app's own users table.
  Client-owned apps work the same way — their users belong to the client
  because the app does.
- **Pseudonymous by default.** No real name is required. An OIDC sign-in never
  uses the provider's email as an identity (linking on an unverified address
  is account takeover); further methods are linked from the account page,
  optionally.
- **OIDC clients:** OrangeCat's token endpoint accepts ONLY
  `client_secret_post` (the default basic auth gets a misleading 400 "client_id
  is required"), and PKCE is required even for confidential clients. Register a
  client by adding a spec to orangecat's `scripts/oauth/register-client.ts`,
  identity scopes only, then run it on the box.

Personas (Morulia) are a layer on the shared sign-in, not a further login
provider: see `docs/identity-personas.md`.

Causius runs on the package (2026-10-15). Loki, Solon, Heidi, Substrata and
evig still federate to OrangeCat through next-auth; each moves onto
`@bitbaum/accountkit/auth` deliberately, one at a time.

### Why better-auth and not next-auth

Because `next-auth` could not be enforced, and this file's whole premise is
that unenforced choices drift. `blessed-versions.json` says so in its own
comment — *"next-auth is deliberately absent while v5 is beta"* — so
`version-currency.mjs`, the audit that turns every other drift into a number,
was structurally blind to the one technology where inconsistency is most
expensive. The row said "v5 when stable"; v5 has been in beta for about three
years, npm `latest` is still 4.x, and six repos shipped the beta anyway — two
of them on *different* betas, because a caret on a prerelease spans them.

`better-auth` has a real semver major, so it goes in `blessed-versions.json`
and the existing audit measures it for free. No new machinery. It also uses the
blessed ORM (Drizzle + `pg`), its magic-link plugin takes our own sender so
`mail-kit` slots in unchanged, and hirnli has run it in production since 2026-09.

### One package, not a copied template (changed 2026-10-15)

Accounts are **`@bitbaum/accountkit/auth`** — one versioned package, installed
by every product. A product passes in what is its own (its address, its
database, its mail sender) and gets the same methods, limits, cookie rules and
account-linking rules as every other:

    export const { GET, POST, getSession, requireUser } = createAuthRuntime({ site, mail, isDatabaseConfigured, getDatabase });

The account tables come from `@bitbaum/accountkit/auth/schema`, re-exported by
each product's schema file, so every product generates the same migration.
Each product keeps its own users table, its own roles and its own look; the
sign-in screens it renders are its own components.

This reverses the rule that said "do not extract an auth package; copy
`templates/app/lib/auth/` into each product and own it". That rule promised
uniformity and guaranteed drift: seven products would each carry their own
copy of the hardest code in the stack, and a fix to one copy reaches nobody
else. The owner asked for no drift (2026-10-15). The reason the rule gave —
`sitekit` shipped bugs consumers could not patch because it centralised
**markup** — still holds, and is why the package ships logic and tables, not
pages.

Fix auth bugs **in accountkit**, never in a product. Products move onto the
package one at a time, deliberately, not "on contact". Causius was first
(causius#23, live 2026-10-15); the rest of the order is in the owner's queue.

## Migration state (2026-09-02: DONE)

Every migration this file opened with has landed, deployed, and been
live-verified:

- **ORM — Drizzle everywhere**: biaslens #26, reparaturbonus-zh #130,
  solon #136, aoz-begleitung #154. Schema parity proven per repo by normalized
  pg_dump diff (aoz: byte-empty over ~1500 DDL lines); live-DB cutovers via
  pre-merge dual-ledger baselining, zero destructive statements, row counts
  accounted for. `grep -rni prisma` clean in all four.
- **Test runner — Vitest for every app**: orangecat #859, evig #429 (a
  parallel session's conversion, verified at identical parity), aoz-begleitung
  #157 (+#159 lockfile). Every conversion at exact suite parity; jest
  deleted everywhere.
- **Deploy fallback**: the shared selfhost-deploy .nvmrc fallback tracks
  the box (Node 24) since loki #461 — the npm-major writer/reader
  split that stranded aoz's first vitest deploy is closed at the source.

**Open — the AI layer is installed, not adopted.** Census 2026-09-06,
measured against `origin/main` of every repo by real import statements
(package.json rows and same-named local files both lie):

- `@bitbaum/ai-kit` is a dependency of **10** repos, every one of which
  actually imports it. Nine are on `^0.6.2`; only surf-your-life tracks
  the current engine.
- **12 repos still hand-roll an LLM HTTP call** alongside it, ~7,000
  lines in total. Installing the package did not retire the client it
  was meant to replace, because until 0.7.0 the package did not ship
  one.
- The weakest link is the same everywhere: **9 of the 12 cannot tell the
  three kinds of 429 apart**, and 6 return an empty HTTP 200 to a user
  as though it were an answer (`content || ''`). Only aoz-begleitung and
  loki get all three judgements right, and both do it by calling
  into ai-kit.
- Highest-value conversions, ranked by how many of the three they get
  wrong: evig's second `src/lib/hirn/*` stack (3 wrong, sitting beside
  an already-converted one in the same repo), botsmann's Python research
  agent (3 wrong, plus a retired `llama-3.1-70b-versatile` id), ai-forms'
  example app (3 wrong, and it is the code adopters copy), orangecat
  (2 wrong, ~2,600 lines, largest surface), vitareba (2 wrong, ~50
  lines, cheapest win).

Nothing else open. Closed 2026-09-04: **pnpm sweep DONE** — all 26 npm repos
converted to pnpm 11 (every PR merged by the auto-merge sweep; deployed
apps health-verified live), on top of the 5 already-pnpm repos (of which
kivvi still pins `pnpm@9` — see the table); ai-kit npm bootstrap DONE
(published, git-tag pin tracking retired from blessed-versions.json —
**zero** ai-kit git-tag pins remain on any default branch, re-counted
2026-09-06);
openclaw fork CI baseline repaired (synced to upstream, main green,
fork-exempt in the ratchet). Closed 2026-09-02: evig email reviewed →
documented exception; OC's @google/generative-ai was import-free dead
weight → deleted.

## Rules

1. New repos start on the blessed column. No exceptions without a row here.
   Concretely: a new product starts from `templates/app`, which is this table
   wired up and tested (see its README for how it is rendered).
2. An exception is a documented architecture decision, not a habit. If the
   reason dies, the exception dies.
3. When a migration lands, update "Migration state" in the same PR.
