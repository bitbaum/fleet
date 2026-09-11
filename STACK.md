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
| ORM / DB access | **Drizzle ORM** + `pg` driver | orangecat, botsmann: supabase-js (self-hosted Supabase architecture: RLS/auth/PostgREST). fleetcrown runner & ivy-portal: better-sqlite3 for embedded local state. |
| Database | Postgres (self-hosted; Supabase where the app is Supabase-native) | fleetcrown runner/ivy: SQLite embedded |
| Auth — **who the user is** | **Federate to OrangeCat** (OIDC, `openid profile email`). The app keeps NO users table. See "Identity" below. | orangecat itself IS the identity provider. Client-owned apps never federate — their users belong to the client. |
| Auth — **client-owned apps** | **`better-auth` 1.x** + Drizzle/Postgres, magic link via `@bitbaum/mail-kit` | aoz-housing (hand-rolled `jose`), botsmann + printcraft (Supabase Auth) — all pre-date the decision; migrate on contact, not on a schedule |
| Test runner (apps) | Vitest | fleetcrown: bespoke tsx gate scripts (deliberate architecture — each script is a named gate) |
| Test runner (packages) | node:test (zero-dep) | — |
| E2E | Playwright | — |
| Email | `@bitbaum/mail-kit` from npm (Resend over raw fetch; one shared free-tier account, all senders `<app>@fleetcrown.orangecat.ch`; daily canary in this repo's email-canary.yml) | evig: Listmonk stays for bulk/newsletter (self-hosted FOSS) + nodemailer SMTP fallback behind the provider seam; transactional mail is Resend (the 2026-09-02 "Listmonk primary" review predates discovering the prod SMTP cred was DEAD — Login denied, live-probed 2026-09-05). GoTrue (self-hosted Supabase auth) sends via Resend SMTP :587 — SMTP is its only interface |
| i18n | next-intl | — |
| AI | `@bitbaum/ai-kit` from npm (the fleet engine; on npm since 2026-09-04) | forks (openclaw) follow upstream. Git-tag pins: ZERO on default branches since 2026-09-05 (surf-your-life #51, kivvi #76, datacat #248 converted the last three) |
| Forms | react-hook-form (+ ai-forms for AI fill) | — |
| Package manager | pnpm 11 (fleet-wide since 2026-09-04; `packageManager` pinned per repo, corepack) | openclaw follows upstream; kivvi (already-pnpm before the sweep) still pins `pnpm@9` — bump pending |
| Runtime | Node LTS (currently 24), nodesource on the box | openclaw gateway: its own nvm-pinned Node |
| Deploy | push → PR → CI → auto-merge sweep → CD → box (systemd + Caddy) | — |

## Identity (2026-09-11)

**There are two populations of user, and conflating them is the mistake this
section exists to prevent.**

**1. Our own products federate.** OrangeCat is the identity SSOT and has been
since its OIDC provider shipped 2026-06-17 — discovery, authorize, token,
userinfo, jwks, PKCE, refresh rotation. FleetCrown federated 2026-07-02, Solon
after, Heidi 2026-09-11. A federated app keeps **no users table, no password,
no reset flow, no session table**. It reads `id_token.sub` — the actor id,
never the email — and stops.

The instruction the identity-bridge spec gives FleetCrown generalises to all of
them: *"Do NOT build profiles, walls, or messaging inside FleetCrown."* If your
app needs profiles, payments or a public presence, those live at OrangeCat.
Rebuilding them locally is the same mistake in a different repo.

Register a client by adding a spec to orangecat's
`scripts/oauth/register-client.ts` — identity scopes only unless the app
genuinely acts on OrangeCat's behalf — then run it on the box. Copy Solon's or
Heidi's provider config verbatim: OrangeCat's token endpoint accepts ONLY
`client_secret_post` (Auth.js defaults to `client_secret_basic`, which OC
rejects with a 400 reading "client_id is required"), and PKCE is required even
for confidential clients. Both cost a debugging cycle the first time.

**2. Client-owned apps never federate.** aoz-housing's residents belong to AOZ,
not to us. Those apps keep local auth, and the blessed library for new local
auth is **better-auth 1.x**.

### Why better-auth and not next-auth, for the local case

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

### What NOT to do

Do **not** extract an auth package. `SHARED.md` lists auth under "what must NOT
be centralized" — coupled to the framework *and* the user schema — and
`sitekit` is the evidence: it centralised nav markup, serves 2 of 20 repos, and
shipped defects consumers could not patch because they did not own the markup.
Centralising the markup centralised the bug.

Share the **decisions** (this section) and the **checks**, never the
implementation. Existing apps migrate **on contact** — when someone is already
in the auth path fixing something — never as a scheduled project. That is the
only way adoption has ever moved here; ADR-0002 sat at "Proposed" for seven
months while the duplicate count went 2 → 4.

## Migration state (2026-09-02: DONE)

Every migration this file opened with has landed, deployed, and been
live-verified:

- **ORM — Drizzle everywhere**: biaslens #26, reparaturbonus-zh #130,
  solon #136, aoz-housing #154. Schema parity proven per repo by normalized
  pg_dump diff (aoz: byte-empty over ~1500 DDL lines); live-DB cutovers via
  pre-merge dual-ledger baselining, zero destructive statements, row counts
  accounted for. `grep -rni prisma` clean in all four.
- **Test runner — Vitest for every app**: orangecat #859, evig #429 (a
  parallel session's conversion, verified at identical parity), aoz-housing
  #157 (+#159 lockfile). Every conversion at exact suite parity; jest
  deleted everywhere.
- **Deploy fallback**: the shared selfhost-deploy .nvmrc fallback tracks
  the box (Node 24) since fleetcrown #461 — the npm-major writer/reader
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
  as though it were an answer (`content || ''`). Only aoz-housing and
  fleetcrown get all three judgements right, and both do it by calling
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
2. An exception is a documented architecture decision, not a habit. If the
   reason dies, the exception dies.
3. When a migration lands, update "Migration state" in the same PR.
