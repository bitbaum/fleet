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

function fetchManifest(owner, repo) {
  try {
    const raw = gh(["api", `repos/${owner}/${repo}/contents/package.json`, "--jq", ".content"]);
    return JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    return undefined; // unreadable OR absent — resolved by root listing below
  }
}

function hasPackageJson(owner, repo) {
  try {
    const raw = gh(["api", `repos/${owner}/${repo}/contents/`, "--jq", "[.[].name]"]);
    return JSON.parse(raw).includes("package.json");
  } catch {
    return null; // could not even list — UNCHECKED
  }
}

function main() {
  const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--update") ? "update" : "report";
  const owner = process.env.GH_OWNER || "bitbaum";
  const limit = Number(process.env.GH_LIMIT || 100);
  const blessed = JSON.parse(readFileSync(BLESSED_PATH, "utf8"));

  const { repos, forks } = listRepos(owner, limit);
  const results = [];
  for (const repo of repos) {
    const present = hasPackageJson(owner, repo);
    if (present === false) continue; // shell/docs repo: no Node surface, not a gap
    if (present === null) {
      results.push({ repo }); // UNCHECKED
      continue;
    }
    const pkg = fetchManifest(owner, repo);
    if (pkg === undefined) {
      results.push({ repo }); // listed but unreadable — UNCHECKED, never zero
      continue;
    }
    results.push({ repo, pkg, gaps: gapsFor(pkg, blessed) });
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
