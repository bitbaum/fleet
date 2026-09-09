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

## Producers

- Serve (port, process, host): `fleetcrown/scripts/hetzner/apps.conf`.
  A hostname or a path in that file is not a display name.
- Org facts (public name, unregistered, house address, host): `registers/org.json`.
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
- An `orangecat.ch` name is an address on the Hetzner box, not a product of OrangeCat.
- GitHub Pages is not a host.

## Packages

Use a package when the same behavior must exist in more than one product:
tokens, mail, threads, a model client, a list query. Do not put a company list
in a package. Do not add auth, ai-kit, or bip-kit unless the page needs a
signed-in user, a model, or a public changelog.

A page that types the portfolio is a copy. Generate it, or do not ship it.
