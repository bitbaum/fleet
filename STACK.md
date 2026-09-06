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
| Auth | next-auth (v5 when stable) | orangecat, botsmann: Supabase Auth (architecture, not drift) |
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
