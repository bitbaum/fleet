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
| Email | Resend | evig: nodemailer pending review — if its self-hosted SMTP relay is deliberate, document it here; otherwise migrate |
| i18n | next-intl | — |
| AI | ai-kit (the fleet engine) | forks (openclaw) follow upstream |
| Forms | react-hook-form (+ ai-forms for AI fill) | — |
| Package manager | npm today; **pnpm once ai-kit is on npm** (the git-pin/pnpm lockfile trap gates the sweep) | kivvi, openclaw, petvity, surf-your-life, vitareba already pnpm |
| Runtime | Node LTS (currently 24), nodesource on the box | openclaw gateway: its own nvm-pinned Node |
| Deploy | push → PR → CI → auto-merge sweep → CD → box (systemd + Caddy) | — |

## Migration state (2026-09-01)

- ORM: **4 repos migrating Prisma → Drizzle** — biaslens, reparaturbonus-zh
  (in flight), then solon, aoz-housing (largest; 88 call-site files). Decisive
  math: Prisma 7's own breaking changes (client output relocation, driver
  adapters, prisma.config.ts) touch nearly the same surface as the Drizzle
  migration — staying costs almost as much as switching, once.
- Test runner: evig jest → Vitest in flight; aoz-housing has vitest PR #141
  from a parallel session.
- Everything else in the table is already true (currency arc, 2026-08-31).

## Rules

1. New repos start on the blessed column. No exceptions without a row here.
2. An exception is a documented architecture decision, not a habit. If the
   reason dies, the exception dies.
3. When a migration lands, update "Migration state" in the same PR.
