#!/usr/bin/env node
/**
 * Fleet audit: how far is each repo from the blessed version of everything
 * it uses — and is that distance shrinking?
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-31 a manual audit of all 38 repos found the production box on
 * Node 20 four months past EOL, one app (aoz-housing) a full framework
 * generation behind on every axis at once, the flagship's own CLAUDE.md
 * describing a Tailwind major that main had left months earlier, and ai-kit
 * pinned at three different tags across seven consumers — one of them still
 * pointing at the repo's pre-org-move OWNER. None of this was hidden. All of
 * it was unmeasured, so none of it ever became anyone's next action.
 *
 * Same doctrine as shared-inventory.sh: writing "keep dependencies current"
 * in a doc is what already failed. This produces a NUMBER per repo — how many
 * key packages sit below the fleet's blessed major — and `--check` makes the
 * total a ratchet: it may fall, it may hold, it may never rise.
 *
 * WHAT IS BLESSED
 * ---------------
 * blessed-versions.json, next to this script, is the SSOT. Raising a blessed
 * major there is a deliberate PR — the moment the fleet decides "Next 17 is
 * the standard now", every repo below it becomes a counted gap. The audit
 * never decides what is current; it only measures distance from the decision.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * That a repo at the blessed major WORKS — CI proves that, per repo. And it
 * judges only manifests it could READ: a repo whose package.json could not be
 * fetched is reported UNCHECKED, never counted as gap-free. "I could not
 * look" and "nothing is stale" are different answers, and collapsing them is
 * how a broken detector reports a healthy fleet.
 *
 * AND IT IS BLIND BELOW THE MAJOR — deliberately, but the blindness has a cost
 * worth naming here rather than rediscovering. `parseMajor("^16.2.12")` is 16;
 * blessed is 16; no gap. Every minor and patch is invisible. It also reads the
 * declared RANGE, while the lockfile decides what actually ships — a caret that
 * ALLOWS 16.3.4 sits happily on 16.2.12 forever, because an already-satisfied
 * dependency is never upgraded on install.
 *
 * On 2026-09-10 that combination hid two CRITICAL unauthenticated RCEs in Next
 * on a live site for months: this audit returned zero gaps for both
 * `"^16.2.12"` and `"16.2.3"`. Do not extend it into a security check — the
 * security question is answered by dependabot-alerts-audit.sh, which asks
 * whether each repo can REPORT a CVE at all, and by GitHub's own continuous
 * scanning of the lockfiles once that switch is on. This one answers a
 * different question: are we on the major the fleet agreed to.
 *
 * IT USED TO READ ONLY THE ROOT MANIFEST
 * --------------------------------------
 * Which meant a monorepo consumer was invisible, and its silence read exactly
 * like currency. Measured 2026-09-12: kivvi installs @bitbaum/ai-kit in
 * `packages/ai` at ^0.15.0 and datacat in `backend` at ^0.13.0, against a
 * published 1.4.1 — neither repo appeared in a single gap report, and both sat
 * in the "current (0 gaps)" line, which is a stronger claim than "not looked
 * at" and was not true.
 *
 * So it now walks workspace manifests too, and every probe is EVIDENCE-BASED:
 * a directory is listed before a manifest inside it is fetched, so "no
 * package.json here" is something the listing said, never a 404 being read as
 * an answer. The cost is a handful of extra listings on the six repos that
 * actually have workspaces; every other repo pays nothing.
 *
 * Reads each repo's REMOTE default branch via the contents API, never a local
 * checkout: clones drift, and this fleet has already shipped a redundant PR
 * off a stale clone.
 *
 * Usage:
 *   node scripts/ci/version-currency.mjs            # report
 *   node scripts/ci/version-currency.mjs --check    # ratchet: exit 1 if total gaps ROSE
 *   node scripts/ci/version-currency.mjs --update   # rewrite the baseline (do it in a PR)
 *
 * Env: GH_OWNER (default bitbaum), GH_LIMIT (default 100)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BLESSED_PATH = join(HERE, "blessed-versions.json");
const BASELINE_PATH = process.env.VERSION_CURRENCY_BASELINE || join(HERE, "version-currency.baseline");

// ── Pure logic (exported for the self-test; no network below this line) ─────

/** First integer in a semver-ish range: "^16.2.3" -> 16, "16" -> 16, "*" -> null. */
export function parseMajor(range) {
  if (typeof range !== "string") return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Is this dependency value a git pin (github:owner/repo#tag)? Returns {owner, repo, tag} or null. */
export function parseGitPin(range) {
  if (typeof range !== "string") return null;
  const m = range.match(/^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?#(.+)$/);
  return m ? { owner: m[1], repo: m[2], tag: m[3] } : null;
}

/**
 * Gaps for one manifest against the blessed config.
 * Returns an array of human-readable gap strings; empty = current.
 */
export function gapsFor(pkg, blessed) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const gaps = [];
  for (const [name, blessedMajor] of Object.entries(blessed.majors)) {
    if (!(name in deps)) continue;
    const have = parseMajor(deps[name]);
    if (have !== null && have < blessedMajor) {
      gaps.push(`${name} ${deps[name]} < blessed ${blessedMajor}`);
    }
  }
  for (const [name, blessedTag] of Object.entries(blessed.internal_tags || {})) {
    if (!(name in deps)) continue;
    const pin = parseGitPin(deps[name]);
    if (pin) {
      if (pin.owner !== (process.env.GH_OWNER || "bitbaum")) {
        gaps.push(`${name} pinned at owner ${pin.owner} (dead after org move)`);
      } else if (pin.tag !== blessedTag) {
        gaps.push(`${name} #${pin.tag} != blessed #${blessedTag}`);
      }
    }
    // A registry version pin is not judged here — once packages are on npm,
    // move them into `majors` and delete the internal_tags entry.
  }
  return gaps;
}

/**
 * Directories that hold workspace members (one manifest per CHILD), and
 * directories that are themselves a sub-app (one manifest directly inside).
 *
 * Both lists are needed because the fleet has both shapes: kivvi/evig/orangecat/
 * petvity/fleetcrown are pnpm workspaces with `packages/` (kivvi also `apps/`),
 * while datacat is not a workspace at all — just `frontend/` and `backend/`
 * side by side, each with its own manifest. A rule that only understood
 * workspaces would have kept missing datacat, which is one of the two repos
 * this change exists for.
 */
export const WORKSPACE_CONTAINERS = ["packages", "apps", "services"];
export const SUBAPP_DIRS = ["frontend", "backend", "api", "web", "server", "client"];

/**
 * Given a repo's ROOT directory listing, which directories are worth listing.
 *
 * Pure, so the decision is testable without the network. Deliberately driven
 * by what the listing actually contains: a name absent from the root is never
 * probed, so the audit cannot mistake a 404 for "no manifest here".
 */
export function dirsToExplore(rootNames) {
  const names = new Set(rootNames || []);
  return {
    containers: WORKSPACE_CONTAINERS.filter((d) => names.has(d)),
    subapps: SUBAPP_DIRS.filter((d) => names.has(d)),
  };
}

/**
 * Gaps found in a non-root manifest are labelled with their directory.
 *
 * `kivvi` and `kivvi packages/ai` are different facts about different files,
 * and a report that prints them identically sends someone to edit the wrong
 * manifest. The root's gaps stay unlabelled so existing output is unchanged.
 */
export function labelGaps(gaps, path) {
  if (path === "package.json") return gaps;
  const dir = path.replace(/\/package\.json$/, "");
  return gaps.map((g) => `${dir}/ — ${g}`);
}

/** Collate per-repo results into the report + total. */
export function collate(results) {
  const checked = results.filter((r) => r.pkg !== undefined);
  const unchecked = results.filter((r) => r.pkg === undefined);
  const rows = checked
    .map((r) => ({ repo: r.repo, gaps: r.gaps }))
    .sort((a, b) => b.gaps.length - a.gaps.length || a.repo.localeCompare(b.repo));
  const total = rows.reduce((n, r) => n + r.gaps.length, 0);
  return { rows, total, uncheckedRepos: unchecked.map((r) => r.repo) };
}

// ── Fleet reading (network) ─────────────────────────────────────────────────

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 60000 });
}

/**
 * Forks are EXEMPT, not measured. A fork that tracks an upstream does not own
 * its manifest — upstream's dependency policy is the SSOT, and patching the
 * fork's lockfile only buys merge friction (learned on bitbaum/openclaw
 * 2026-09-01: an openai bump there could never be more current than the next
 * upstream sync, and its CI baseline belongs to upstream too). A fork's
 * currency action is SYNCING, which this audit cannot ratchet. Exempted forks
 * are printed by name so the exemption is visible, never silent.
 */
function listRepos(owner, limit) {
  const raw = gh(["repo", "list", owner, "--limit", String(limit), "--json", "name,isArchived,isFork"]);
  const all = JSON.parse(raw).filter((r) => !r.isArchived);
  return {
    repos: all.filter((r) => !r.isFork).map((r) => r.name).sort(),
    forks: all.filter((r) => r.isFork).map((r) => r.name).sort(),
  };
}

function fetchManifest(owner, repo, path = "package.json") {
  try {
    const raw = gh(["api", `repos/${owner}/${repo}/contents/${path}`, "--jq", ".content"]);
    return JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    return undefined; // unreadable OR absent — resolved by root listing below
  }
}

/** Names in a directory, or null if it could not be listed at all. */
function listDir(owner, repo, path = "") {
  try {
    const raw = gh(["api", `repos/${owner}/${repo}/contents/${path}`, "--jq", "[.[].name]"]);
    return JSON.parse(raw);
  } catch {
    return null; // could not look — never the same as "nothing there"
  }
}

/**
 * Every manifest worth judging in one repo: the root, plus each workspace
 * member and sub-app. Each is confirmed present by a LISTING before it is
 * fetched.
 */
function manifestPaths(owner, repo, rootNames) {
  const paths = rootNames.includes("package.json") ? ["package.json"] : [];
  const { containers, subapps } = dirsToExplore(rootNames);

  for (const dir of subapps) {
    const names = listDir(owner, repo, dir);
    if (names && names.includes("package.json")) paths.push(`${dir}/package.json`);
  }
  for (const container of containers) {
    const children = listDir(owner, repo, container);
    if (!children) continue;
    for (const child of children) {
      const names = listDir(owner, repo, `${container}/${child}`);
      if (names && names.includes("package.json")) paths.push(`${container}/${child}/package.json`);
    }
  }
  return paths;
}

function main() {
  const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--update") ? "update" : "report";
  const owner = process.env.GH_OWNER || "bitbaum";
  const limit = Number(process.env.GH_LIMIT || 100);
  const blessed = JSON.parse(readFileSync(BLESSED_PATH, "utf8"));

  const { repos, forks } = listRepos(owner, limit);
  const results = [];
  for (const repo of repos) {
    const rootNames = listDir(owner, repo);
    if (rootNames === null) {
      results.push({ repo }); // could not even list — UNCHECKED
      continue;
    }
    const paths = manifestPaths(owner, repo, rootNames);
    if (paths.length === 0) continue; // shell/docs repo: no Node surface, not a gap

    // UNCHECKED is decided by the ROOT manifest, which is what "this repo was
    // measured" has always meant. A workspace member that cannot be read is a
    // hole in coverage, not grounds for discarding the repo's real findings —
    // but it must not pass silently either, so it is named below.
    let rootPkg;
    const gaps = [];
    const unreadable = [];
    for (const path of paths) {
      const pkg = fetchManifest(owner, repo, path);
      if (pkg === undefined) { unreadable.push(path); continue; }
      if (path === "package.json") rootPkg = pkg;
      gaps.push(...labelGaps(gapsFor(pkg, blessed), path));
    }

    const rootRequired = paths.includes("package.json");
    if (rootRequired && rootPkg === undefined) {
      results.push({ repo }); // listed but unreadable — UNCHECKED, never zero
      continue;
    }
    results.push({ repo, pkg: rootPkg ?? {}, gaps, unreadable });
  }

  const { rows, total, uncheckedRepos } = collate(results);

  console.log(`version-currency: ${rows.length} repos measured against blessed-versions.json`);
  for (const r of rows) {
    if (r.gaps.length === 0) continue;
    console.log(`\n  ${r.repo} (${r.gaps.length})`);
    for (const g of r.gaps) console.log(`    - ${g}`);
  }
  const current = rows.filter((r) => r.gaps.length === 0).map((r) => r.repo);
  if (current.length) console.log(`\n  current (0 gaps): ${current.join(", ")}`);

  // A workspace manifest that was listed but could not be fetched is a hole in
  // this run's coverage. Printed by name, because the alternative is a repo
  // appearing in "current (0 gaps)" on the strength of files nobody read.
  const partial = results.filter((r) => r.unreadable && r.unreadable.length > 0);
  if (partial.length) {
    console.log("\n  PARTIAL (some manifests unreadable — their contents are not in the total):");
    for (const r of partial) console.log(`    ${r.repo}: ${r.unreadable.join(", ")}`);
  }
  if (uncheckedRepos.length) {
    console.log(`\n  UNCHECKED (could not read — not counted as clean): ${uncheckedRepos.join(", ")}`);
  }
  if (forks.length) {
    console.log(`\n  fork-exempt (upstream owns the manifest; currency = syncing): ${forks.join(", ")}`);
  }
  console.log(`\n  TOTAL GAPS: ${total}`);

  if (mode === "update") {
    writeFileSync(BASELINE_PATH, `${total}\n`);
    console.log(`  baseline written: ${total}`);
    return;
  }
  if (mode === "check") {
    let baseline;
    try {
      baseline = Number(readFileSync(BASELINE_PATH, "utf8").trim());
    } catch {
      console.error("  no baseline — run --update in a PR first");
      process.exit(1);
    }
    if (Number.isNaN(baseline)) {
      console.error("  baseline unreadable — refusing to compare against garbage");
      process.exit(1);
    }
    if (total > baseline) {
      console.error(`  RATCHET: gaps rose ${baseline} -> ${total}. Fix the regressions or raise the baseline in a PR a human sees.`);
      process.exit(1);
    }
    if (total < baseline) {
      console.log(`  gaps fell ${baseline} -> ${total} — tighten the baseline with --update in your next PR`);
    } else {
      console.log(`  holding at ${total}`);
    }
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
