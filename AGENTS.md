# For every agent

Claude, Codex, Antigravity, Cursor, Grok, FleetCrown, and anything else read
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

Memory is read from the session's working directory
(`~/.claude/projects/<slug>/memory/`), so a lesson written in one repo is
invisible from every other. A fleet-wide lesson written into a project silo is
lost. That is the same bug as a private copy: put it where the readers are.

## Producers

- Serve (port, process, host): `fleetcrown/scripts/hetzner/apps.conf`.
  A hostname or a path in that file is not a display name.
- Org facts (public name, unregistered, house address, host): `registers/org.json`.
- Tools we develop with (agent names): `registers/toolchain.json`.
  The build stack (framework, ORM, package manager) is `STACK.md`.
- Display name, kind, and who the work is for: the venture register. Until that
  file exists, do not invent a name. The product title in that repo is the
  temporary source, and a page that disagrees with it is a bug.
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

## Packages

Use a package when the same behavior must exist in more than one product:
tokens, mail, threads, a model client, a list query. Do not put a company list
in a package. Do not add auth, ai-kit, or bip-kit unless the page needs a
signed-in user, a model, or a public changelog.

A page that types the portfolio is a copy. Generate it, or do not ship it.

## Repos you create

The fleet creates repos automatically now — FleetCrown provisions one per
project, and agents scaffold sites to test that path. Six appeared in two days
in September 2026, none registered in `apps.conf`, and together they were 15 of
the 26 gaps that were about to turn the version-currency ratchet red against a
committed baseline of 0. Nothing was wrong with any single one of them. A
ratchet does not die disputed, it dies drowned: a gate whose number is mostly
noise gets muted, and every true finding inside it is muted with it.

**The rule is in `~/.claude/CLAUDE.md`: tear the experiment down in the same
session that created it, repo included — not archived, not left private, gone.**
Per-site teardown is `fleetcrown: scripts/hetzner/retire-site.sh`, which also
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
