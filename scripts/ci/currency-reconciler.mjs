#!/usr/bin/env node
/**
 * Plan first-party updates across every tracked project manifest.
 * Targets are freshly published npm versions or exact CI-verified Git releases.
 * Compare them with immutable locked artifacts, preserve aliases, and refuse
 * downgrades. Every row leases the consumer source commit; the acting workflow
 * rejects a moving default branch instead of applying a stale decision.
 *
 * Public automation scans only explicitly public, non-fork repositories.
 * --include-private is a local report only and cannot emit a public matrix.
 * Missing trees/manifests/locks abort the scan; partial coverage is not health.
 *
 * node scripts/ci/currency-reconciler.mjs [--json | --include-private]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { currencyRepositories, currencySnapshot } from "./currency-snapshot.mjs";
import { releaseTargets } from "./package-release-target.mjs";
import { preferredPackageUpdate, immutableGitArtifact } from "./preferred-package-update.mjs";
import { registeredGitDependency, gitPackageVersion } from "./git-package-currency.mjs";

/** Our own packages, and nobody else's. See "what it will NOT do". */
export const INTERNAL_SCOPE = "@bitbaum/";

/**
 * 2026-10-25 complete public-tree scan: 27 repositories / 94 updates,
 * including nested starters and the verified Design Tokens Git release.
 * The reviewed queue is real; 30 clears it while still rejecting an update
 * to every one of the 51 public repositories. Concurrency remains three.
 */
export const MAX_PRS = 30;

/**
 * Split a registry range into its operator and its floor version.
 *
 * Returns null for anything that is not a plain registry range — a git pin, a
 * `workspace:*`, a `file:`, a URL, a tag like `latest`, or a range complex
 * enough that rewriting it mechanically would be guessing (`>=1.2 <2`, `||`).
 * Null means LEAVE IT ALONE, which is the safe direction: this script's worst
 * possible bug is quietly rewriting a range somebody chose deliberately.
 */
export function parseRange(range) {
  if (typeof range !== "string") return null;
  const raw = range.trim();
  const m = /^([\^~]?)(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(raw);
  if (!m) return null;
  return { op: m[1], major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4]) };
}

/** A published version string, or null if it is not a plain release. */
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** -1, 0, 1. Ordinary semver ordering over release versions. */
export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Is this range's FLOOR behind the latest published version?
 *
 * The floor, not the ceiling, and that distinction is the whole measurement.
 * `^1.4.0` *resolves* to 1.11.0 on a fresh install — but no repo installs
 * fresh: every one pins through a lockfile, which is what makes shared
 * packages safe here and is also why a caret alone changes nothing. The floor
 * is what the manifest COMMITS to, and raising it is what makes `pnpm update`
 * produce a lockfile change somebody can review.
 *
 * `^0.15.0` against 1.11.0 is the severe case and is reported as such: a caret
 * on a 0.x version pins the MINOR, so those repos cannot receive a fix even by
 * running `pnpm update`. They need this deliberate bump or they get nothing,
 * ever.
 */
export function behind(range, latest) {
  const have = parseRange(range);
  const want = parseVersion(latest);
  if (!have || !want) return null;
  if (compareVersions(have, want) >= 0) return null;
  return {
    from: range,
    to: bumpRange(range, latest),
    // A 0.x caret cannot cross its own minor, so `pnpm update` will not move
    // it and no ordinary currency sweep ever will either.
    stranded: have.major === 0 && have.major !== want.major,
    crossesMajor: have.major !== want.major,
  };
}

/** The same range, with its floor raised. The operator is preserved. */
export function bumpRange(range, latest) {
  const have = parseRange(range);
  if (!have) return range;
  return `${have.op}${latest}`;
}

/** Registered Bitbaum npm entries of one manifest, deps and devDeps alike. */
export function npmInternalNames(packages) {
  return new Set((packages?.packages ?? [])
    .filter((pkg) => pkg?.install?.source === "npm" && pkg?.version && pkg?.name)
    .map((pkg) => pkg.name));
}

/** Resolve a direct internal dependency or an npm alias to its package identity. */
export function internalDependency(name, specifier, npmNames = new Set()) {
  let packageName = name;
  let range = specifier;
  let alias = false;

  if (typeof specifier === "string" && specifier.startsWith("npm:")) {
    const target = specifier.slice(4);
    const separator = target.lastIndexOf("@");
    if (separator <= target.indexOf("/")) return null;
    packageName = target.slice(0, separator);
    range = target.slice(separator + 1);
    alias = true;
  }

  const owned = packageName.startsWith(INTERNAL_SCOPE) || npmNames.has(packageName);
  if (!owned || !parseRange(range)) return null;
  return { packageName, range, alias };
}

/** The fleet's published npm packages from the curated shared registry. */
export function internalDepsOf(pkg, npmNames = new Set()) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.optionalDependencies || {}) };
  const out = {};
  for (const [name, range] of Object.entries(deps)) {
    if (internalDependency(name, range, npmNames)) out[name] = range;
  }
  return out;
}

/**
 * Everything one manifest is behind on.
 *
 * Pure: hand it a manifest and a `{name: latestVersion}` map and it answers
 * without touching the network, which is what makes the self-test real.
 */
export function planForManifest(repo, path, pkg, latestByName, npmNames = new Set()) {
  const rows = [];
  for (const [name, specifier] of Object.entries(internalDepsOf(pkg, npmNames))) {
    const identity = internalDependency(name, specifier, npmNames);
    if (!identity) continue;
    const latest = latestByName[identity.packageName];
    if (!latest) continue; // never published, or npm could not be asked
    const gap = behind(identity.range, latest);
    if (gap) {
      const to = identity.alias ? `npm:${identity.packageName}@${bumpRange(identity.range, latest)}` : bumpRange(identity.range, latest);
      rows.push({ repo, path, name, packageName: identity.packageName, latest, ...gap, from: specifier, to });
    }
  }
  return rows;
}

/**
 * One branch per repo, named for what it does rather than for when it ran.
 *
 * Stable on purpose. A re-run finds its own open PR and updates that branch
 * instead of opening a second one, so a reconciler that fires every week
 * cannot accumulate a drawer of near-identical pull requests — which is the
 * failure mode that gets bots muted, and a muted bot is worse than no bot.
 */
export function branchFor() {
  return "fleet/internal-currency";
}

/** `npm view <name> version`, or null if it could not be asked. */
export function latestOf(name, { run = npmView } = {}) {
  try {
    const out = run(name);
    return parseVersion(out) ? out.trim() : null;
  } catch {
    return null;
  }
}

function npmView(name) {
  return execFileSync("npm", ["view", name, "version"], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Group flat rows into one entry per repo — the shape the workflow matrix wants. */
export function byRepo(rows) {
  const repos = new Map();
  for (const row of rows) {
    if (!repos.has(row.repo)) repos.set(row.repo, { repo: row.repo, bumps: [] });
    repos.get(row.repo).bumps.push(row);
  }
  return [...repos.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

function describe(row) {
  const flag = row.stranded ? " STRANDED" : row.crossesMajor ? " (major)" : "";
  const where = row.path === "package.json" ? "" : ` ${row.path.replace(/\/package\.json$/, "")}/`;
  return `${row.name} ${row.from} → ${row.to}${flag}${where}`;
}

async function main() {
  const owner = process.env.GH_OWNER || "bitbaum";
  const asJson = process.argv.includes("--json");

  const includePrivate = process.argv.includes("--include-private");
  if (includePrivate && asJson) throw new Error("Private audit is local report only; cannot emit an automation matrix");
  const repos = currencyRepositories(owner, includePrivate);
  const registry = JSON.parse(readFileSync(new URL("../../registers/packages.json", import.meta.url), "utf8"));
  const targets = new Map((await releaseTargets(registry.packages)).map(pkg => [pkg.name, pkg]));
  const npmNames = new Set(registry.packages.map(pkg => pkg.name));
  const rows = [];
  const unreadable = [];
  const gitVersions = new Map();

  for (const repo of repos) {
    try {
      const snapshot = currencySnapshot(owner, repo);
      for (const path of snapshot.paths) {
        const pkg = snapshot.manifest(path);
        const entries = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
        const interested = entries.map(([name, from]) => {
          const git = registeredGitDependency(from, registry);
          const identity = git ? { packageName: git.name } : internalDependency(name, from, npmNames);
          return { name, from, identity };
        }).filter(entry => entry.identity);
        if (!interested.length) continue;
        const artifacts = snapshot.artifacts(path, pkg);
        for (const { name, from, identity } of interested) {
          let target = targets.get(identity.packageName);
          if (!target) {
            const version = latestOf(identity.packageName);
            if (!parseVersion(version)) throw new Error(`No published target: ${identity.packageName}`);
            target = { version, release: { source: "npm" } };
            targets.set(identity.packageName, target);
          }
          const artifact = artifacts[identity.packageName];
          let currentVersion = artifact;
          if (!parseVersion(currentVersion)) {
            const lockedGit = immutableGitArtifact(artifact);
            const registeredRepo = registry.packages.find(p => p.name === identity.packageName)?.repo;
            if (!lockedGit || registeredRepo !== `https://github.com/${lockedGit.repo}`)
              throw new Error(`Unresolved locked artifact: ${path}: ${name}`);
            const key = `${lockedGit.repo}#${lockedGit.sha}`;
            if (!gitVersions.has(key)) gitVersions.set(key, gitPackageVersion(lockedGit.repo, lockedGit.sha));
            currentVersion = gitVersions.get(key);
          }
          const row = preferredPackageUpdate({ repo, path, name, from, identity, currentVersion, target, sourceSha: snapshot.commit });
          if (row) rows.push(row);
        }
      }
    } catch (error) {
      unreadable.push(`${repo}: ${error.message}`);
    }
  }
  // Never act on a partial census: API/manifest/lock failures are unknown, not current.
  if (unreadable.length) throw new Error(`Currency scan incomplete:\n${unreadable.join("\n")}`);

  const plan = byRepo(rows);

  if (asJson && unreadable.length) console.error(`UNCHECKED repositories: ${unreadable.join(", ")}`);

  if (asJson) {
    // Over the cap, emit an EMPTY matrix rather than the plan. The workflow
    // acts on whatever this prints, so refusing here is the refusal.
    if (plan.length > MAX_PRS) {
      console.error(`Refusing ${plan.length} repository updates: cap is ${MAX_PRS}; inspect the plan before changing it.`);
      process.exitCode = 1;
    }
    console.log(JSON.stringify(plan.length > MAX_PRS ? [] : plan));
    return;
  }

  console.log(`Internal package currency across ${repos.length} ${includePrivate ? "local public/private" : "public"} repos in ${owner}:\n`);

  if (plan.length === 0) {
    console.log("No update planned for checked registered shared dependencies; see any UNCHECKED entries below.");
  } else {
    for (const entry of plan) {
      console.log(`  ${entry.repo}`);
      for (const row of entry.bumps) console.log(`      ${describe(row)}`);
    }
    const stranded = rows.filter((r) => r.stranded);
    if (stranded.length) {
      console.log(
        `\n  ${stranded.length} STRANDED: a caret on 0.x pins the MINOR, so these cannot` +
          `\n  receive a fix even by running \`pnpm update\`. Only a deliberate bump moves them.`,
      );
    }
  }

  if (unreadable.length) {
    console.log(`\n  UNCHECKED (could not read): ${unreadable.join(", ")}`);
    console.log("  Not a pass. Re-run with a token that can see them.");
  }

  if (plan.length > MAX_PRS) {
    console.error(
      `\n✗ ${plan.length} repos want a bump, over the cap of ${MAX_PRS}. Opening NONE.` +
        `\n  A whole fleet going stale at once is likelier a bug in this predicate than` +
        `\n  ${plan.length} genuinely stale repos. Read the plan above before raising the cap.`,
    );
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) await main();
