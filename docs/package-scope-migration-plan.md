# Move the four unscoped packages under `@bitbaum`

Status: planned 2026-11-06 (owner: "let's do all that"). Nothing below is done
until a link in the status table says so.

## Why

Fourteen fleet packages are `@bitbaum/*` and live under the `bitbaum` npm
organization. Four were published earlier, before the scope was adopted, and
never moved, so they sit on the owner's personal npm profile:

| Package (today) | First published | Adopters (`registers/packages.json`) |
| --------------- | --------------- | ------------------------------------ |
| `ai-forms`      | 2026-08-16      | 7                                    |
| `threadkit`     | 2026-08-16      | 6                                    |
| `bip-kit`       | 2026-08-21      | 17                                   |
| `limitkit`      | 2026-09-05      | 17                                   |

`@bitbaum/design-tokens` (2026-09-05) was the first scoped package. No document
records a decision to leave these four unscoped; it is drift. Costs: one
account owns them instead of the organization, trusted publishing is linked in
two kinds of place, and the registry, docs and audits carry a naming exception
(`SHARED.md` still describes an "unscoped `ai-*` name").

## Target

`@bitbaum/ai-forms`, `@bitbaum/threadkit`, `@bitbaum/bip-kit`,
`@bitbaum/limitkit`. Same code, same version numbers, same repositories. The old
names stay installable (never unpublished) and are deprecated with a pointer
once no adopter uses them.

## Prerequisite: a first publish for every new name

npm trusts a publisher only for a package that already exists, so each new name
needs one token-based first publish (`NPM_BOOTSTRAP_TOKEN`, see
`templates/package/.github/workflows/publish.yml`). The same org secret covers
all of them, and `@bitbaum/writingkit` (never published; its 2026-11-06 Publish
run logged `BOOTSTRAP: false`, so the secret was not visible to that repo).
After each first publish the workflow links trusted publishing itself.

## Order

1. **Packages** (one PR per repo, the package's own CI and release): rename
   `name` in `package.json`, README/CHANGELOG, imports in tests and demos;
   keep the version; `exports` unchanged. Publish under the new name. Verify the
   packed tarball installs and imports under the new name.
2. **Fleet** (this repo): `registers/package-repos.json` and the generated
   `registers/packages.json` carry the new name and a `formerName`; the
   currency reconciler, shared-registry audit, package-composition audit,
   rollout gate and their tests accept the new name; `SHARED.md` drops the
   "unscoped" note. Audits must treat the old name as a legacy alias until step 5.
3. **Codemod** (`scripts/packages/rename-package.mjs`, dry run by default, one
   non-draft PR per repo on a `fleet/package-scope` branch, same shape as
   `sync-agent-rules.mjs`): rewrite dependency names and import specifiers in
   source, `package.json`, `pnpm-workspace.yaml` (release-age exclusions),
   `package-plan.json` bindings and docs. Aliases (`@fleet/ai-forms` in Solon and
   BiasLens) become `npm:@bitbaum/ai-forms@^x`; the alias name may stay until
   those apps are next touched. Each PR passes the consumer's own verify.
4. **Adopters** merge through the sweep; the rollout gate and canary rules
   apply as for any package change (OrangeCat first).
5. **Deprecate** the old names (`npm deprecate`, message names the new package)
   only when the register shows no adopter on them. Never `npm unpublish`.

Adopters per `registers/packages.json`: bip-kit — aoz-begleitung, biaslens,
bitbaum, botsmann, causius, datacat, diplodoctor, evig, fleet, heidi, kivvi,
loki, orangecat, petvity, skif, solon, substrata; limitkit — accountkit,
aoz-begleitung, biaslens, botsmann, causius, diplodoctor, evig, fleet, heidi,
kivvi, loki, morulia, orangecat, petvity, skif, surf-your-life, truthseeker;
ai-forms — ai-kit, aoz-begleitung, biaslens, evig, kivvi, loki, surf-your-life;
threadkit — aoz-begleitung, heidi, orangecat, skif, substrata, vitareba.
Repos the fleet does not manage automatically (`--include-private` is local
report only) are listed for their owners rather than edited.

## Acceptance

- `npm view @bitbaum/<name>` serves the same version as the old name, with
  provenance, maintained by the organization.
- A consumer built from the new name passes its full verify; no consumer
  references the old name (grep and lockfile) before deprecation.
- Registers, audits, docs and templates carry no unscoped exception.
- Old names remain installable and are deprecated, not removed.

## Status

| Step                                | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org secret visible to package repos | done 2026-11-06; keep until all four names are on npm, then delete the token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1. Package PRs                      | limitkit [#42](https://github.com/bitbaum/limitkit/pull/42), threadkit [#51](https://github.com/bitbaum/threadkit/pull/51)/[#52](https://github.com/bitbaum/threadkit/pull/52) and bip-kit [#58](https://github.com/bitbaum/bip-kit/pull/58)/[#59](https://github.com/bitbaum/bip-kit/pull/59) merged and on npm (`@bitbaum/limitkit` 0.2.1, `@bitbaum/threadkit` 0.1.1, `@bitbaum/bip-kit` 0.6.1); ai-forms [#62](https://github.com/bitbaum/ai-forms/pull/62) open. Three of the four repos still had the older OIDC-only Publish workflow, which cannot make a first publish; each got the current template |
| 2. Fleet registers/audits           | not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3. Codemod                          | written, with a self-test in CI; applied to one adopter per PR, OrangeCat first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4. Adopters                         | not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5. Deprecation                      | not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
