# For every agent

Claude, Codex, Antigravity, Cursor, Grok, Loki, and anything else read
this file. Do not keep a private copy of these facts. If a fact is not in a
register, it is not true yet.

## How docs stay current

A fact has one producer. A doc may point at the producer. A doc may not restate
the fact. To change what something is called, or where it lives, edit the
producer. The copies are the bug.

Each repo keeps a short `AGENTS.md`: the pointer in `templates/AGENTS.md`, then
only facts that exist only in that repo (how to run it, where the tests are).
`CLAUDE.md` and any other agent file point here. They do not get their own
essay of the org.

## Your context may be stale

Agent instruction files are read from the working tree, not from the remote. A
checkout that has not pulled feeds you guidance frozen at whenever it last
moved, and gives you no signal that this happened. Measured 2026-09-09: a
session rediscovered a deploy-verification rule over a full day that had been
committed five days earlier, and on the same day reported this file missing
because the checkout sat on an older branch.

Before trusting instructions, and before reporting that a file does not exist:

    git fetch -q && git log HEAD..origin/HEAD --oneline -- AGENTS.md CLAUDE.md .claude/

A working tree is evidence of one branch at one moment. `origin` is the fact.

## What a local scan cannot see

`grep` in this shell is a function wrapping `ugrep --ignore-files`. It honours
`.gitignore`. Measured 2026-09-12 in orangecat: `grep -rl SUPABASE_SERVICE_ROLE_KEY`
found 1 file, `command grep -rl` found 18. Env files, build output and
`.claude/worktrees/` are invisible to the first. A sweep that must not miss
anything uses `command grep`, `git grep`, or an explicit path.

A worktree is a subdirectory of the repo. A sweep that must not EDIT anything
outside your branch uses `git grep -l`, which reads the index and so cannot
reach another branch's checkout. `find | xargs sed` does not respect
`.gitignore` and will rewrite files on branches nobody is working on: ten
worktrees across four repos carried an uncommitted org rename for two weeks
that way, on branches whose own work had stopped days earlier.

Audits already avoid this by reading default branches over the API rather than
disk. A local sweep has to choose the same scope deliberately.

Memory is read from the session's working directory
(`~/.claude/projects/<slug>/memory/`), so a lesson written in one repo is
invisible from every other. A fleet-wide lesson written into a project silo is
lost. That is the same bug as a private copy: put it where the readers are.

## Producers

- Serve (port, process, host): `loki/scripts/hetzner/apps.conf`.
  A hostname or a path in that file is not a display name.
- Org facts (public name, unregistered, house address, host): `registers/org.json`.
- Tools we develop with (agent names): `registers/toolchain.json`.
  The build stack (framework, ORM, package manager) is `STACK.md`.
- Display name, kind, who the work is for, and what the product IS: a Loki
  project profile, published at `loki.orangecat.ch/api/fleet/register` (the
  platform join) and `/api/fleet/map` (the venture list). A page that disagrees
  with it is a bug. See "The identity contract" below before writing any of it
  down a second time.
- Repeating behavior: one package, one job. A package does not store names or
  hosts. Do not merge kits to make a wiki.
- Design: `@bitbaum/design-tokens`. A site is data rendered by `sitekit`.

## Names agents must share

- Public name is Cato. Nothing here is registered.
- AOZ is AOZ. Do not revive an older label. A deploy path is not the name.
- hirnli is hirnli. A leftover slug in the serve file is not a second product.
- The agent name is Antigravity. Do not write Gemini.
- An `orangecat.ch` name is an address on the Hetzner box, not a product of OrangeCat.
- GitHub Pages is not a host.
- **Nothing is Live. Everything is beta — OrangeCat included.** `live` in
  `apps.conf` is a PROVISIONING fact: the process is served and Caddy has a
  vhost. It is not a release state, and rendering it as one is a claim nobody
  here can back. "Live" is reserved for something we would be comfortable
  releasing; today that is nothing, so the word appears on no public surface.
  This is the same column-misread as `client-app` two fields over, which is why
  that one is published as Pilot and Concept rather than "client".
  A product that is served says **beta**; one that is served and unfinished
  says so in full: "Beta — running, not released". "N products run today" is
  fine — that is a claim about processes, not about readiness.

## The identity contract

Six things are true of every product we ship, and a reader must be able to find
all six: **problem, solution, mission, vision, roadmap, changelog.**

**They already have a producer. Do not invent a second one.** A Loki project
profile holds all six today: `problem` / `solution` / `mission` / `vision` are
canonical keys in `loki: src/config/project-attrs.ts`, the roadmap is the
`goals` table, the changelog is `user_projects.dev_log`. They are edited in the
project's Context tab and injected into every dispatch, so the agent building a
product and the page describing it read the same words — which is the entire
reason to keep one copy.

So: **a product site RENDERS these, it does not author them.** A `ROADMAP` in a
TypeScript literal is a copy, and it rots on schedule. Measured 2026-09-15:
orangecat's public changelog carried 13 entries, newest dated 2026-07-31, while
its main branch ran to PR #1039 on 2026-09-14. Loki's own `/changelog` is a
`redirect()`. `bip-kit` exists to render exactly these from markdown and has
eight adopters; seven of them use it for blogs only. `aoz-housing` is the one
repo doing it right, and is the pattern to copy.

**A profile is not a page — it is the same fact on three surfaces.** A product
has a Loki project (how it gets built), an OrangeCat profile (how it is funded
and found) and a Solon organisation (how it is governed). All three are joined
by repo slug and published at `/api/fleet/register`; the six themselves ride on
`/api/fleet/map`, which is what the audit reads. Of the 16 projects that have
shipped, on 2026-09-15: **roadmap missing on 14**, a Solon organisation on 11,
an OrangeCat profile on 10.

    fleet: node scripts/ci/product-identity-audit.mjs          # report
    fleet: node scripts/ci/product-identity-audit.mjs --check  # ratchet

The audit judges only mechanical claims — a field is empty, a profile is
absent — never whether prose is good, for the reason `repo-metadata-audit.mjs`
gives. It reports two things it deliberately does not count: generated
experiments still in the register, and projects that are not live anywhere.

**It reads the map, not the register, and that is load-bearing.** The register
takes `status` from `apps.conf`, which deliberately omits the handcrafted
4001-4004 services — so `loki` and `orangecat`, two of the three pillars, had no
row and every rule skipped them while they served the public internet. The map
resolves a project with a live URL and no hosting row as live.

Adding a field is one row in that audit's `FIELDS` table. Adding a seventh
*thing* is a conversation, not a commit.

## Packages

Use a package when the same behavior must exist in more than one product:
tokens, mail, threads, a model client, a list query. Do not put a company list
in a package. Do not add auth, ai-kit, or bip-kit unless the page needs a
signed-in user, a model, or a public changelog.

A page that types the portfolio is a copy. Generate it, or do not ship it.

## Repos you create

The fleet creates repos automatically now — Loki provisions one per
project, and agents scaffold sites to test that path. Six appeared in two days
in September 2026, none registered in `apps.conf`, and together they were 15 of
the 26 gaps that were about to turn the version-currency ratchet red against a
committed baseline of 0. Nothing was wrong with any single one of them. A
ratchet does not die disputed, it dies drowned: a gate whose number is mostly
noise gets muted, and every true finding inside it is muted with it.

**The rule is in `~/.claude/CLAUDE.md`: tear the experiment down in the same
session that created it, repo included — not archived, not left private, gone.**
Per-site teardown is `loki: scripts/hetzner/retire-site.sh`, which also
owns the Caddy vhost and the `apps.conf` row. None of that is restated here.

What is here is the backstop, because that rule covers the session that creates
a repo and nothing covers the session that dies, is interrupted, or forgets —
which is how all six survived. So when you create a throwaway repo:

- **Mark it at birth** with the GitHub topic `fleet-ephemeral`. On the repo, not
  in a list somebody has to remember to update — then a later sweep can find it
  without anyone having to recognise the name.
- **Say so in the description** too, for the human who meets it first.
- **Do not** give it a homepage, an `apps.conf` row, or a domain. If it becomes
  real, drop the topic; that is the promotion.

Marking is insurance against your own cleanup not happening. It costs one flag
at creation and it is the only reason an abandoned experiment is findable later:

    fleet: scripts/local/prune-ephemeral-repos.sh                 # list, read-only
    fleet: scripts/local/prune-ephemeral-repos.sh --delete --yes  # the intended action
    fleet: scripts/local/prune-ephemeral-repos.sh --mark <repo>   # backfill an existing one

The pruner refuses to touch anything that is not marked — "it is obviously a
test repo" is the reasoning that eventually deletes something real.
