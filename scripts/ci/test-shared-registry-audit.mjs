#!/usr/bin/env node
/**
 * Self-test for shared-registry-audit.mjs. No network, no gh, no checkout.
 *
 * Every fixture is the real thing that fooled a reader: the alias spellings
 * that made a five-adopter package read as zero, the prose mention that made a
 * missing row look present, the repo that is its own package. Both directions
 * are pinned on each — the gap is found AND the non-gap stays silent — because
 * an audit that reports everything passes every one-sided test.
 */

import {
  canonical, depCandidates, ownedPackages, countAdopters,
  registryEntries, findGaps, ADOPTER_THRESHOLD,
} from "./shared-registry-audit.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.error(`  ✗ ${m}`); };
const eq = (got, want, m) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  g === w ? ok(m) : bad(`${m}\n      got:  ${g}\n      want: ${w}`);
};

console.log("test-shared-registry-audit");

// ── canonical ────────────────────────────────────────────────────────────────
eq(canonical("@bitbaum/ai-kit"), "ai-kit", "a scoped name canonicalises to its unscoped half");
eq(canonical("ai-kit"), "ai-kit", "an unscoped name is already canonical");
eq(canonical("@fleet/design-tokens"), "design-tokens", "the alias scope is irrelevant");
eq(canonical(undefined), null, "a missing name canonicalises to null, not to a crash");
eq(canonical("@bitbaum/"), null, "a malformed scoped name does not become the empty string");

// ── depCandidates: the four spellings, all real ──────────────────────────────
eq([...depCandidates("@bitbaum/mail-kit", "^0.1.0")], ["mail-kit"],
   "a plain scoped dependency resolves to the package");
eq([...depCandidates("@fleet/ai-forms", "npm:ai-forms@^0.1.2")].sort(), ["ai-forms"],
   "an npm: alias resolves to the ALIASED package, not the key");
eq([...depCandidates("sitekit", "npm:@bitbaum/sitekit@^0.3.0")].sort(), ["sitekit"],
   "an alias onto a scoped package resolves to the same canonical name");
eq([...depCandidates("listkit", "github:bitbaum/listkit#v0.1.0")].sort(), ["listkit"],
   "a github: specifier resolves through the repo name");
eq([...depCandidates("next", "^16.0.0")], ["next"],
   "a third-party dependency resolves to itself (and is filtered later, not here)");

// Every alias in this fleet today happens to keep the package's unscoped name
// (`@fleet/ai-forms` -> ai-forms), so the key alone would resolve it. That is a
// CONVENTION, not a guarantee, and an audit that silently depends on it breaks
// on the first alias that renames. Pin the case the convention does not cover.
eq([...depCandidates("legacy-forms", "npm:ai-forms@^0.1.2")].sort(), ["ai-forms", "legacy-forms"],
   "an alias whose key does NOT match still resolves through the value");
eq([...depCandidates("vendored-kit", "github:bitbaum/limitkit#v0.2.0")].sort(), ["limitkit", "vendored-kit"],
   "a renamed github: specifier still resolves through the repo name");

// ── ownedPackages ────────────────────────────────────────────────────────────
const manifests = [
  { repo: "ai-kit",   path: "package.json", pkg: { name: "@bitbaum/ai-kit", version: "1.4.1" } },
  { repo: "bip-kit",  path: "package.json", pkg: { name: "bip-kit" } },
  { repo: "design-tokens", path: "package.json", pkg: { name: "@bitbaum/design-tokens" } },
  { repo: "orangecat", path: "package.json", pkg: {
      name: "orangecat",
      dependencies: { "@bitbaum/ai-kit": "^1.4.1", "bip-kit": "^0.2.7" } } },
  { repo: "fleetcrown", path: "package.json", pkg: {
      name: "fleetcrown",
      dependencies: { "bip-kit": "^0.2.7", "@bitbaum/design-tokens": "1.1.0" } } },
  { repo: "solon", path: "package.json", pkg: {
      name: "solon",
      dependencies: { "@fleet/design-tokens": "npm:@bitbaum/design-tokens@^1.1.0" } } },
  // A nested manifest: still an adopter. datacat/backend and kivvi/packages/ai
  // are invisible to a root-only reader, which is a real blind spot elsewhere.
  { repo: "kivvi", path: "packages/ai/package.json", pkg: {
      name: "@kivvi/ai", dependencies: { "@bitbaum/ai-kit": "^0.15.0" } } },
  // The same repo naming a package twice must still count once.
  { repo: "kivvi", path: "apps/web/package.json", pkg: {
      name: "@kivvi/web", dependencies: { "@bitbaum/ai-kit": "^0.15.0" } } },
];

const owned = ownedPackages(manifests);
eq([...owned.keys()].sort(), ["ai-kit", "bip-kit", "design-tokens", "fleetcrown", "orangecat", "solon"],
   "owned packages come from each repo's ROOT manifest identity");
{
  // A nested manifest must not register a package name for the whole org --
  // @kivvi/ai is not a fleet package anyone can install.
  owned.has("ai") ? bad("a nested workspace package was registered as fleet-owned")
                  : ok("a nested workspace package is not treated as a fleet package");
}

// ── countAdopters ────────────────────────────────────────────────────────────
const adopters = countAdopters(manifests, owned);
eq([...adopters.get("ai-kit")].sort(), ["kivvi", "orangecat"],
   "adopters include a NESTED consumer, and a repo with two manifests counts once");
eq([...adopters.get("bip-kit")].sort(), ["fleetcrown", "orangecat"],
   "a plain dependency is counted");
eq([...adopters.get("design-tokens")].sort(), ["fleetcrown", "solon"],
   "an aliased dependency is counted — this is the case that read as zero");
eq([...adopters.get("orangecat")], [],
   "an app nobody depends on has no adopters");
{
  const selfCount = [...adopters.get("ai-kit")].includes("ai-kit");
  selfCount ? bad("a package counted its own repo as an adopter")
            : ok("a package's own repo is not an adopter of it");
}

// ── registryEntries: table rows only, never prose ────────────────────────────
const md = [
  "| Package | Install | Replaces |",
  "|---|---|---|",
  "| [`ai-kit`](https://github.com/bitbaum/ai-kit) | `pnpm add @bitbaum/ai-kit` | the AI layer |",
  "| [`design-tokens`](https://github.com/bitbaum/design-tokens) | `...` | brand SSOT |",
  "",
  "Some prose that mentions bip-kit and threadkit without listing either.",
  "| slug helper | 3 | bip-kit, evig, hirnli — a candidates table, not the registry |",
].join("\n");
const listed = registryEntries(md);
eq([...listed].sort(), ["ai-kit", "design-tokens"], "only linked table rows count as registry entries");
{
  listed.has("bip-kit")
    ? bad("a prose mention of bip-kit was counted as a registry row — the exact 2026-09-12 failure")
    : ok("a prose mention is NOT a registry row (the bip-kit failure stays caught)");
}

// ── findGaps, both directions ────────────────────────────────────────────────
{
  const gaps = findGaps({ adopters, listed, owned });
  eq(gaps.map((g) => g.pkg), ["bip-kit"],
     "a 2-adopter package with no row is the finding; the listed ones are silent");
  eq(gaps[0].adopters, ["fleetcrown", "orangecat"], "the finding names who depends on it");
}
{
  // Vacuous-pass guard: when everything is listed, the audit must report NO
  // gaps rather than keep reporting the last one it knew about.
  const all = new Set([...listed, "bip-kit"]);
  eq(findGaps({ adopters, listed: all, owned }).length, 0,
     "once the row exists, the finding disappears (the gate can go green)");
}
{
  // Threshold: a single-adopter package is not yet a registry obligation.
  const oneAdopter = new Map([["lonelykit", new Set(["orangecat"])]]);
  const ownedOne = new Map([["lonelykit", "lonelykit"]]);
  eq(findGaps({ adopters: oneAdopter, listed: new Set(), owned: ownedOne }).length, 0,
     `a single adopter is below the threshold of ${ADOPTER_THRESHOLD}`);
  const twoAdopters = new Map([["lonelykit", new Set(["orangecat", "fleetcrown"])]]);
  eq(findGaps({ adopters: twoAdopters, listed: new Set(), owned: ownedOne }).length, 1,
     `the ${ADOPTER_THRESHOLD}nd adopter makes it a finding`);
}
{
  // An empty fleet must produce no findings and no crash.
  eq(findGaps({ adopters: new Map(), listed: new Set(), owned: new Map() }).length, 0,
     "an empty graph yields no findings");
}

console.log();
console.log(`test-shared-registry-audit: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
