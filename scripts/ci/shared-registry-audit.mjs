#!/usr/bin/env node
/**
 * Does SHARED.md's registry match the actual dependency graph?
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-12 `bip-kit` had eight adopters — third-most-used package in the
 * fleet — and no row in the registry whose first line reads "Before you build
 * something, check this file. If it is here, install it." It appeared in the
 * file only as a *source* of slug-helper duplication. `@bitbaum/design-tokens`
 * had two adopters and appeared nowhere at all.
 *
 * Nobody was careless. The registry is maintained by hand, and a hand-
 * maintained index of a graph that changes underneath it drifts by default.
 * That is the same argument SHARED.md makes about copied code, applied to
 * SHARED.md, which is the one place it had never been applied — every audit in
 * this repo sweeps the OTHER repos.
 *
 * So: the adopter count is derived from package.json across the org, and a
 * package the fleet actually depends on must have a row. The number of missing
 * rows is the finding; --check makes it binding.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge the CONTENT of a row — whether the prose is accurate or
 * the install line current. A gate that guesses at prose gets muted. It checks
 * the one mechanical claim: a package with real adopters is findable here.
 *
 *   node scripts/ci/shared-registry-audit.mjs           # report
 *   node scripts/ci/shared-registry-audit.mjs --check   # exit 1 if a row is missing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED_MD = process.env.SHARED_MD_PATH || join(HERE, "..", "..", "SHARED.md");

/** A package with at least this many adopting repos must have a registry row. */
export const ADOPTER_THRESHOLD = 2;

/**
 * The canonical key for a package is its UNSCOPED name.
 *
 * The same package is written four ways across this fleet: `@bitbaum/ai-kit`
 * in a dependency, `ai-kit` in the registry table and as the repo name,
 * `@fleet/ai-forms` as an install alias, and `bitbaum/listkit` inside a github:
 * specifier. Comparing raw strings reports drift that is only spelling.
 */
export function canonical(name) {
  if (!name) return null;
  const unscoped = name.startsWith("@") ? name.split("/")[1] : name;
  return unscoped ? unscoped.toLowerCase() : null;
}

/**
 * Every package a dependency entry could be referring to.
 *
 * Half the fleet installs under an alias, so the KEY is not reliably the
 * package. A key-only reader reports zero adopters for a package with five —
 * measured, not hypothetical: that is what the first pass of this audit did.
 *
 *   "@fleet/ai-forms": "npm:ai-forms@^0.1.2"        -> ai-forms
 *   "sitekit": "npm:@bitbaum/sitekit@^0.3.0"        -> sitekit
 *   "listkit": "github:bitbaum/listkit#v0.1.0"      -> listkit
 *   "@bitbaum/mail-kit": "^0.1.0"                   -> mail-kit
 */
export function depCandidates(key, value) {
  const out = new Set();
  const add = (n) => { const c = canonical(n); if (c) out.add(c); };
  add(key);
  if (typeof value === "string") {
    const npmAlias = value.match(/^npm:(@[^/]+\/[^@]+|[^@][^@]*)@?/);
    if (npmAlias) add(npmAlias[1]);
    const gitRef = value.match(/^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#.*)?$/);
    if (gitRef) add(gitRef[2]);
  }
  return out;
}

/**
 * Which packages does this fleet publish? Derived from the repos themselves:
 * a repo whose package.json declares a name IS that package. No second list to
 * keep in sync — the thing being measured is its own register.
 */
export function ownedPackages(manifests) {
  const owned = new Map(); // canonical -> repo name
  for (const { repo, path, pkg } of manifests) {
    if (path !== "package.json") continue; // the repo's own identity is at its root
    const c = canonical(pkg?.name);
    if (c) owned.set(c, repo);
  }
  return owned;
}

/**
 * Adopters per owned package. A repo never counts as its own adopter, and a
 * repo is counted once however many of its manifests name the package —
 * kivvi installs ai-kit in packages/ai and mail-kit in apps/web, and that is
 * one adopting repo each, not two.
 */
export function countAdopters(manifests, owned) {
  const adopters = new Map();
  for (const c of owned.keys()) adopters.set(c, new Set());
  for (const { repo, pkg } of manifests) {
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    for (const [key, value] of Object.entries(deps)) {
      for (const cand of depCandidates(key, value)) {
        if (!adopters.has(cand)) continue;
        if (owned.get(cand) === repo) continue; // its own repo
        adopters.get(cand).add(repo);
      }
    }
  }
  return adopters;
}

/**
 * Package names listed in the registry table.
 *
 * Anchored to the table rows specifically — a row is `| [`name`](url) | ... |`
 * — and NOT to any mention of the name in the file. bip-kit was mentioned in
 * the prose for weeks while missing from the table, and a substring search
 * over the whole document would have called that covered. The failure this
 * audit exists to catch is precisely "named somewhere, not findable in the
 * registry".
 */
export function registryEntries(markdown) {
  const listed = new Set();
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\|\s*\[`([^`]+)`\]\(/);
    if (m) { const c = canonical(m[1]); if (c) listed.add(c); }
  }
  return listed;
}

/**
 * The install line, taken from what adopters ACTUALLY write.
 *
 * Not from SHARED.md's prose, which is a claim, and not hardcoded, which is a
 * second source of truth. The most common specifier among real consumers is
 * the honest answer to "how do I add this", and it also encodes the thing an
 * outsider most needs to know: whether it comes from npm or from a git tag.
 * `listkit` is a git tag because the npm name belongs to someone else — a page
 * that printed `pnpm add listkit` would install a stranger's package.
 */
export function installFor(pkgName, specifiers) {
  const counts = new Map();
  for (const s of specifiers) counts.set(s, (counts.get(s) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  if (typeof top === "string") {
    const git = top.match(/^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?(#.*)?$/);
    if (git) return { source: "git", command: `pnpm add ${top.replace(/^git\+https:\/\/github\.com\//, "github:")}` };
    const alias = top.match(/^npm:(@?[^@]+)@/);
    if (alias) return { source: "npm", command: `pnpm add ${alias[1]}` };
  }
  return { source: "npm", command: `pnpm add ${pkgName}` };
}

/** Raw dependency specifiers used for each owned package, across the fleet. */
export function specifiersFor(manifests, owned) {
  const out = new Map();
  for (const c of owned.keys()) out.set(c, []);
  for (const { repo, pkg } of manifests) {
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    for (const [key, value] of Object.entries(deps)) {
      for (const cand of depCandidates(key, value)) {
        if (!out.has(cand) || owned.get(cand) === repo) continue;
        out.get(cand).push(value);
      }
    }
  }
  return out;
}

/**
 * The published shape: one row per package the REGISTRY lists, carrying only
 * derived facts. SHARED.md curates (a package is here because a human wrote
 * the row); this derives (adopters, install, description). Anything a renderer
 * wants that cannot be derived — a short tagline — belongs in that renderer's
 * own editorial file, the way the venture list already works.
 */
export function buildPackagesJson({ listed, owned, adopters, specifiers, manifestByRepo, generatedAt }) {
  const packages = [...listed]
    .filter((c) => owned.has(c))
    .map((c) => {
      const repo = owned.get(c);
      const pkg = manifestByRepo.get(repo) || {};
      const names = [...(adopters.get(c) || [])].sort();
      return {
        slug: c,
        name: pkg.name || c,
        repo: `https://github.com/bitbaum/${repo}`,
        description: pkg.description || null,
        version: pkg.version || null,
        install: installFor(pkg.name || c, specifiers.get(c) || []),
        adopters: names.length,
        adopterNames: names,
      };
    })
    .sort((a, b) => b.adopters - a.adopters || a.slug.localeCompare(b.slug));
  return { generatedAt, packages };
}

/** The finding: owned packages with real adopters and no registry row. */
export function findGaps({ adopters, listed, owned, threshold = ADOPTER_THRESHOLD }) {
  const gaps = [];
  for (const [c, repos] of adopters) {
    if (repos.size >= threshold && !listed.has(c)) {
      gaps.push({ pkg: c, repo: owned.get(c), adopters: [...repos].sort() });
    }
  }
  return gaps.sort((a, b) => b.adopters.length - a.adopters.length || a.pkg.localeCompare(b.pkg));
}

// ── data collection (network) ────────────────────────────────────────────────

function gh(args) {
  // stderr is PIPED, not inherited: a missing manifest is an expected 404 and
  // printing thirteen of them makes a working audit look broken. The error is
  // still available to the caller, which is the half that matters.
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A 404 means "this repo has no such manifest". Anything else means we could not look. */
export function isMissing(err) {
  return /404|Not Found/i.test(String(err?.stderr ?? "") + String(err?.message ?? ""));
}

/** Manifest paths worth looking at. A monorepo consumer is still an adopter. */
const MANIFEST_PATHS = [
  "package.json",
  "apps/web/package.json",
  "packages/ai/package.json",
  "packages/core/package.json",
  "frontend/package.json",
  "backend/package.json",
];

function fetchManifests(owner, limit) {
  const repos = JSON.parse(gh(["repo", "list", owner, "--limit", String(limit),
    "--no-archived", "--json", "name,isFork"]))
    .filter((r) => !r.isFork)
    .map((r) => r.name);

  const manifests = [];
  // Three-valued, like ai-kit/web's search: found, absent, or COULD NOT LOOK.
  // Swallowing every error made a rate-limited or unauthenticated run report
  // the same thing as a clean one — zero adopters — and "nothing depends on
  // this package" is the sentence that gets a package deleted. On 2026-09-12 a
  // grep with that exact blind spot nearly removed bip-kit (8 adopters),
  // limitkit (3) and threadkit (3).
  const unreadable = [];
  for (const repo of repos) {
    for (const path of MANIFEST_PATHS) {
      let raw;
      try {
        raw = gh(["api", `repos/${owner}/${repo}/contents/${path}`, "--jq", ".content"]);
      } catch (err) {
        if (!isMissing(err)) unreadable.push(`${repo}/${path}: ${firstLine(err)}`);
        continue;
      }
      try {
        manifests.push({ repo, path, pkg: JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")) });
      } catch { /* unparseable manifest is not an adopter claim */ }
    }
  }
  return { repos, manifests, unreadable };
}

/** The one line of an error worth showing next to a repo name. */
export function firstLine(err) {
  const text = String(err?.stderr ?? "").trim() || String(err?.message ?? "").trim();
  return text.split("\n")[0].slice(0, 120);
}

function main() {
  const owner = process.env.GH_OWNER || "bitbaum";
  const limit = Number(process.env.GH_LIMIT || 200);
  const check = process.argv.includes("--check");

  const { repos, manifests, unreadable } = fetchManifests(owner, limit);
  if (repos.length === 0) {
    // A sweep that looked at nothing must never read as a clean sweep.
    console.error("⊘ shared-registry audit SKIPPED — gh repo list returned no repos.");
    process.exit(check ? 1 : 0);
  }

  const owned = ownedPackages(manifests);
  const adopters = countAdopters(manifests, owned);
  const listed = registryEntries(readFileSync(SHARED_MD, "utf8"));
  const gaps = findGaps({ adopters, listed, owned });

  // --emit publishes the derived registry so a RENDERER never types the list.
  // bitbaum.orangecat.ch reads this file the same way it already reads
  // FleetCrown's venture register: facts derived here, prose editorial there.
  const emitIdx = process.argv.indexOf("--emit");
  if (emitIdx !== -1) {
    const out = process.argv[emitIdx + 1];
    if (!out) { console.error("--emit needs a path"); process.exit(2); }
    // Publishing a partial scan is worse than publishing nothing: the file is
    // read as the answer to "who uses this", and a repo we could not read
    // looks exactly like a repo that does not use it.
    if (unreadable.length > 0) {
      console.error(`✗ refusing to write ${out}: ${unreadable.length} manifest(s) could not be read`);
      for (const u of unreadable.slice(0, 10)) console.error(`    ${u}`);
      process.exit(2);
    }
    const manifestByRepo = new Map();
    for (const m of manifests) if (m.path === "package.json") manifestByRepo.set(m.repo, m.pkg);
    const payload = buildPackagesJson({
      listed, owned, adopters,
      specifiers: specifiersFor(manifests, owned),
      manifestByRepo,
      generatedAt: new Date().toISOString(),
    });
    writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
    console.log(`wrote ${out} (${payload.packages.length} packages)`);
  }

  console.log(`shared-registry: ${repos.length} repos, ${owned.size} fleet-owned packages, ` +
              `${listed.size} rows in SHARED.md`);
  if (unreadable.length > 0) {
    console.log();
    console.log(`  ⚠ ${unreadable.length} manifest(s) COULD NOT BE READ — the counts below are a floor, not a count:`);
    for (const u of unreadable.slice(0, 10)) console.log(`      ${u}`);
    console.log("  Do not conclude a package is unused from this run.");
  }
  console.log();

  const ranked = [...adopters.entries()]
    .filter(([, r]) => r.size > 0)
    .sort((a, b) => b[1].size - a[1].size);
  for (const [pkg, r] of ranked) {
    const mark = listed.has(pkg) ? "✓" : "✗";
    console.log(`  ${mark} ${pkg.padEnd(20)} ${String(r.size).padStart(2)} adopter(s)  ${[...r].sort().join(", ")}`);
  }

  const unadopted = [...adopters.entries()].filter(([, r]) => r.size === 0).map(([p]) => p);
  if (unadopted.length) {
    console.log();
    console.log(`  (no adopters yet: ${unadopted.sort().join(", ")})`);
    console.log("  A package with zero adopters removes zero duplication — that is a");
    console.log("  publishing question, not a registry defect, so it is not a finding.");
  }

  if (gaps.length === 0) {
    console.log();
    console.log(`✓ every fleet package with ${ADOPTER_THRESHOLD}+ adopters has a registry row.`);
    return;
  }

  console.log();
  console.log(`✗ ${gaps.length} package(s) the fleet depends on are MISSING from the registry:`);
  for (const g of gaps) {
    console.log(`    ${g.pkg} — ${g.adopters.length} adopters (${g.adopters.join(", ")})`);
  }
  console.log();
  console.log("  Add a row to the registry table in SHARED.md. The file's first line");
  console.log("  promises it is there; it is only as true as this table.");
  if (check) process.exit(1);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
