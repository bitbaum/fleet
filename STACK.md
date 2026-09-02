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
| Email | Resend | evig: Listmonk (self-hosted FOSS) primary + nodemailer SMTP fallback — DELIBERATE (reviewed 2026-09-02): its own config/email.ts documents the provider seam with admin diagnostics, and a hosted email SaaS would contradict the project's self-hosting values |
| i18n | next-intl | — |
| AI | ai-kit (the fleet engine) | forks (openclaw) follow upstream |
| Forms | react-hook-form (+ ai-forms for AI fill) | — |
| Package manager | npm today; **pnpm once ai-kit is on npm** (the git-pin/pnpm lockfile trap gates the sweep) | kivvi, openclaw, petvity, surf-your-life, vitareba already pnpm |
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

Still open (tracked): pnpm sweep (gated on ai-kit npm bootstrap); openclaw
fork CI baseline (in repair). Closed 2026-09-02: evig email reviewed →
documented exception; OC's @google/generative-ai was import-free dead
weight → deleted.

## Rules

1. New repos start on the blessed column. No exceptions without a row here.
2. An exception is a documented architecture decision, not a habit. If the
   reason dies, the exception dies.
3. When a migration lands, update "Migration state" in the same PR.
