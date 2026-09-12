#!/usr/bin/env node
/**
 * Self-test for version-currency.mjs.
 * Run: node scripts/ci/test-version-currency.mjs
 *
 * Both sides pinned, per fleet doctrine: the real 2026-08-31 staleness is
 * still caught (positive), a fully-current manifest stays silent (negative),
 * and an unreadable repo is UNCHECKED — never counted as gap-free. The
 * fixtures are the audit that motivated the ratchet: aoz-housing's actual
 * manifest shape, including the dead-owner ai-kit pin.
 */
import {
  parseMajor, parseGitPin, gapsFor, collate,
  dirsToExplore, labelGaps, WORKSPACE_CONTAINERS, SUBAPP_DIRS,
} from "./version-currency.mjs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
}

const blessed = {
  majors: { next: 16, react: 19, tailwindcss: 4, zod: 4, eslint: 10, "@types/node": 26 },
  internal_tags: { "ai-kit": "v0.6.2" },
};

// ── parseMajor / parseGitPin ────────────────────────────────────────────────
check("parseMajor ^16.2.3 -> 16", parseMajor("^16.2.3") === 16);
check("parseMajor '*' -> null", parseMajor("*") === null);
check("parseGitPin github:catomean/ai-kit#v0.4.0",
  JSON.stringify(parseGitPin("github:catomean/ai-kit#v0.4.0")) ===
  JSON.stringify({ owner: "catomean", repo: "ai-kit", tag: "v0.4.0" }));
check("parseGitPin registry range -> null", parseGitPin("^4.5.4") === null);

// ── Positive: the aoz-housing regression is caught ──────────────────────────
const stale = {
  dependencies: { next: "^14.2.5", react: "^18.3.1", "ai-kit": "github:catomean/ai-kit#v0.4.0" },
  devDependencies: { tailwindcss: "^3.4.9", zod: "^3.23.8", eslint: "^8.57.0", "@types/node": "^20.14.10" },
};
const staleGaps = gapsFor(stale, blessed);
check("stale manifest: 6 major gaps + 1 pin gap", staleGaps.length === 7, `got ${JSON.stringify(staleGaps)}`);
check("dead-owner pin is named as such", staleGaps.some((g) => g.includes("dead after org move")));
check("next gap present", staleGaps.some((g) => g.startsWith("next ")));

// ── Negative: a current manifest stays silent ───────────────────────────────
const current = {
  dependencies: { next: "16.3.3", react: "^19.2.8", "ai-kit": "github:bitbaum/ai-kit#v0.6.2" },
  devDependencies: { tailwindcss: "^4.3.3", zod: "^4.5.4", eslint: "^10.9.1", "@types/node": "^26.4.0" },
};
check("current manifest: zero gaps", gapsFor(current, blessed).length === 0,
  `got ${JSON.stringify(gapsFor(current, blessed))}`);

// ── Packages the repo does not use are not gaps ─────────────────────────────
check("absent package is not a gap", gapsFor({ dependencies: {} }, blessed).length === 0);

// ── Right-tag wrong-owner and right-owner wrong-tag both flagged ────────────
check("stale bitbaum tag flagged",
  gapsFor({ dependencies: { "ai-kit": "github:bitbaum/ai-kit#v0.5.0" } }, blessed).length === 1);

// ── Empty/absent internal_tags (live config since ai-kit moved to npm) ─────
check("absent internal_tags: only major gaps counted",
  gapsFor(stale, { majors: blessed.majors }).length === 6);
check("empty internal_tags: leftover git pin is not judged",
  gapsFor({ dependencies: { "ai-kit": "github:bitbaum/ai-kit#v0.5.0" } },
    { majors: blessed.majors, internal_tags: {} }).length === 0);

// ── UNCHECKED is not clean ──────────────────────────────────────────────────
const { rows, total, uncheckedRepos } = collate([
  { repo: "good", pkg: current, gaps: gapsFor(current, blessed) },
  { repo: "bad", pkg: stale, gaps: staleGaps },
  { repo: "unreadable" }, // no pkg — could not fetch
]);
check("unreadable repo lands in UNCHECKED", uncheckedRepos.length === 1 && uncheckedRepos[0] === "unreadable");
check("unreadable repo not in measured rows", rows.every((r) => r.repo !== "unreadable"));
check("total counts only measured gaps", total === 7);
check("worst repo sorts first", rows[0].repo === "bad");

// ── Mutation-proof: a lowered baseline must trip the ratchet ────────────────
// (The ratchet math is `total > baseline` in main(); assert the collate side
// that feeds it — a stale fleet yields a total a clean baseline cannot cover.)
check("mutation: stale total exceeds a clean baseline", total > 0);


// -- Workspace manifests (added 2026-09-12) ---------------------------------
//
// The audit used to read only each repo's root package.json, so a monorepo
// consumer was invisible AND sat in "current (0 gaps)" -- a stronger claim
// than "not looked at", and untrue. kivvi (packages/ai, ^0.15.0) and datacat
// (backend, ^0.13.0) are the two real cases; both shapes are pinned here.

// dirsToExplore is driven by the ROOT LISTING, so a directory that is not
// there is never probed and a 404 can never be read as "no manifest here".
{
  const kivvi = dirsToExplore(["package.json", "pnpm-workspace.yaml", "packages", "apps", "README.md"]);
  check("workspace containers found from the root listing",
    JSON.stringify(kivvi.containers) === JSON.stringify(["packages", "apps"]));
  check("kivvi has no sub-app dirs", kivvi.subapps.length === 0);

  // datacat is NOT a pnpm workspace -- frontend/ and backend/ are plain
  // siblings. A workspace-only rule would keep missing it, which is half the
  // reason this change exists.
  const datacat = dirsToExplore(["package.json", "frontend", "backend"]);
  check("plain sub-app dirs are found without any workspace marker",
    JSON.stringify(datacat.subapps) === JSON.stringify(["frontend", "backend"]));
  check("datacat has no workspace containers", datacat.containers.length === 0);

  // The negative half: a single-package repo must produce nothing to explore,
  // or every repo in the fleet pays for extra listings it does not need.
  const flat = dirsToExplore(["package.json", "src", "README.md", "docs"]);
  check("a flat repo yields no directories to explore",
    flat.containers.length === 0 && flat.subapps.length === 0);

  // A directory named like a container but absent from the listing is never
  // probed. Stated separately so it cannot pass by the filter being vacuous.
  check("a container name absent from the listing is not explored",
    !dirsToExplore(["package.json"]).containers.includes("packages"));
  check("the container and sub-app lists are actually non-empty",
    WORKSPACE_CONTAINERS.length > 0 && SUBAPP_DIRS.length > 0);
}

// labelGaps: a nested finding must say WHICH manifest, or it sends someone to
// edit the wrong file. Root gaps stay unlabelled so existing output is intact.
{
  const g = ["@bitbaum/ai-kit ^0.15.0 < blessed 1"];
  check("a root gap is left unlabelled",
    JSON.stringify(labelGaps(g, "package.json")) === JSON.stringify(g));
  check("a workspace gap names its directory",
    labelGaps(g, "packages/ai/package.json")[0] === "packages/ai/ — @bitbaum/ai-kit ^0.15.0 < blessed 1");
  check("a sub-app gap names its directory",
    labelGaps(g, "backend/package.json")[0] === "backend/ — @bitbaum/ai-kit ^0.15.0 < blessed 1");
  check("labelling an empty gap list stays empty", labelGaps([], "packages/ai/package.json").length === 0);
}

// The end-to-end shape: a repo whose ROOT is current but whose workspace
// member is stale must now report a gap. Under the old root-only reader this
// repo printed as "current (0 gaps)".
{
  const rootCurrent = gapsFor(current, blessed);
  const nested = labelGaps(
    gapsFor({ dependencies: { "@bitbaum/ai-kit": "^0.15.0" } }, { majors: { "@bitbaum/ai-kit": 1 } }),
    "packages/ai/package.json");
  const merged = [...rootCurrent, ...nested];
  check("a current root plus a stale workspace member yields exactly one gap", merged.length === 1);
  check("and that gap is attributed to the workspace member",
    merged[0].startsWith("packages/ai/ — "));
  const { total } = collate([{ repo: "kivvi", pkg: {}, gaps: merged }]);
  check("the workspace gap reaches the ratchet total", total === 1);
}

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
