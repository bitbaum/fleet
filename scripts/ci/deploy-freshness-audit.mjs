#!/usr/bin/env node
/**
 * Did what is on main actually reach the box?
 *
 * WHY THIS EXISTS
 *
 * Nothing in this fleet asks that question. `uptime-sweep.sh` probes
 * /api/health and treats 5xx as DOWN — that proves a process is UP, not that it
 * is running the code we merged. CLAUDE.md already says a health check is not a
 * feature check; this is the missing half.
 *
 * It matters because of how merges reach the box. A push made with
 * GITHUB_TOKEN triggers no workflows, so an auto-merged PR fires no Deploy:
 * measured 2026-09-15 on bitbaum/loki, SIX of the last fifteen commits on main
 * had no Deploy run of their own. They shipped anyway, because the auto-merge
 * sweep RECONCILES every ten minutes — it compares main's tip against the last
 * successful deploy and dispatches when they differ.
 *
 * That reconciler is therefore the single thing standing between "merged" and
 * "live" for most commits, and it has no alarm on it. If it stops — a token
 * scope lapses, the workflow is disabled, the input is dropped (deploy.yml
 * warns "Removing that input makes merges land and never ship") — then CI stays
 * green, PRs keep merging, /api/health keeps returning 200, and the box quietly
 * serves last week's code. The failure is invisible by construction.
 *
 * WHAT IT ASKS
 *
 * Per repo: is main's tip covered by a successful Deploy? A run for that exact
 * SHA counts; so does any successful run that STARTED after the tip was
 * committed, because it deployed main as it stood then. Anything else is only a
 * finding once it is older than the reconciler's own window — before that it is
 * simply pending, and reporting it would be crying wolf every ten minutes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge whether the deployed code WORKS. And it does not read the
 * app's own /api/health `commit` field, tempting as that is: exactly one of
 * thirteen live apps publishes one (measured the same day), so a check built on
 * it would silently cover a single app while looking fleet-wide.
 *
 *   node scripts/ci/deploy-freshness-audit.mjs           # report
 *   node scripts/ci/deploy-freshness-audit.mjs --check   # exit 1 on stale
 */

import { execFileSync } from "node:child_process";

/** How long a merged commit may sit undeployed before it is a finding. The
 *  auto-merge sweep runs every 10 minutes; this is that plus room for a build. */
export const GRACE_MINUTES = 45;

export const FRESHNESS = {
  /** main's tip is covered by a successful deploy. */
  DEPLOYED: "deployed",
  /** Not yet deployed, but still inside the reconciler's window. */
  PENDING: "pending",
  /** Not deployed, and old enough that the reconciler should have caught it. */
  STALE: "stale",
  /** No deploy workflow, or no runs at all — cannot judge, must not read clean. */
  UNKNOWN: "unknown",
};

/**
 * Is main's tip deployed?
 *
 * `deployRuns` are that repo's Deploy runs, newest first, each
 * `{ headSha, status, conclusion, createdAt }`.
 *
 * Two ways to be covered, and the second one matters more than it looks: most
 * commits here never get a run of their own, they ride along on a later
 * reconciler dispatch. Requiring an exact-SHA run would report almost the whole
 * fleet stale while everything was in fact live — the same mistake as checking
 * that the box serves YOUR merge SHA on a main that moves every few minutes.
 */
export function deployFreshness({ tipSha, tipCommittedAt, deployRuns, now, graceMinutes = GRACE_MINUTES }) {
  const runs = (deployRuns ?? []).filter((r) => r && r.status === "completed");
  const good = runs.filter((r) => r.conclusion === "success");
  if (good.length === 0) {
    return { state: FRESHNESS.UNKNOWN, reason: "no successful Deploy run on record" };
  }

  const exact = good.find((r) => r.headSha === tipSha);
  if (exact) return { state: FRESHNESS.DEPLOYED, reason: `deployed by a run for ${short(tipSha)}` };

  const committed = Date.parse(tipCommittedAt);
  const after = good.find((r) => Date.parse(r.createdAt) > committed);
  if (after) {
    return {
      state: FRESHNESS.DEPLOYED,
      reason: `covered by a later successful deploy (${after.createdAt})`,
    };
  }

  const ageMin = (Date.parse(now) - committed) / 60000;
  if (ageMin <= graceMinutes) {
    return {
      state: FRESHNESS.PENDING,
      reason: `merged ${Math.round(ageMin)}m ago; reconciler window is ${graceMinutes}m`,
    };
  }
  return {
    state: FRESHNESS.STALE,
    reason: `main tip is ${Math.round(ageMin)}m old and no deploy has run since it`,
  };
}

const short = (s) => (typeof s === "string" ? s.slice(0, 7) : String(s));

// ── live data ───────────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
}

/** Repos that actually have a deploy workflow — the only ones this can judge. */
function reposWithDeploy(owner, limit) {
  const all = JSON.parse(
    gh(["repo", "list", owner, "--limit", String(limit), "--no-archived", "--json", "name,isFork"]),
  ).filter((r) => !r.isFork).map((r) => r.name);

  const out = [];
  for (const name of all) {
    try {
      const files = JSON.parse(
        gh(["api", `repos/${owner}/${name}/contents/.github/workflows`, "--jq", "[.[].name]"]),
      );
      if (files.some((f) => /deploy/i.test(f))) out.push(name);
    } catch {
      /* no workflows directory: not a deploying repo */
    }
  }
  return out;
}

function tipOf(owner, repo) {
  const c = JSON.parse(
    gh(["api", `repos/${owner}/${repo}/commits?per_page=1`, "--jq",
        "[.[0].sha, .[0].commit.committer.date]"]),
  );
  return { sha: c[0], committedAt: c[1] };
}

function deployRunsOf(owner, repo) {
  try {
    return JSON.parse(
      gh(["api", `repos/${owner}/${repo}/actions/runs?per_page=40&branch=main`, "--jq",
          "[.workflow_runs[] | select(.name | test(\"deploy\";\"i\")) | {headSha: .head_sha, status, conclusion, createdAt: .created_at}]"]),
    );
  } catch {
    return [];
  }
}

function main() {
  const owner = process.env.GH_OWNER || "bitbaum";
  const limit = Number(process.env.GH_LIMIT || 200);
  const check = process.argv.includes("--check");
  const now = new Date().toISOString();

  const repos = reposWithDeploy(owner, limit);
  if (repos.length === 0) {
    // A sweep that judged nothing must never read as a clean sweep.
    console.error("⊘ deploy-freshness SKIPPED — no repos with a deploy workflow were found.");
    process.exit(check ? 1 : 0);
  }

  const rows = [];
  for (const repo of repos) {
    try {
      const tip = tipOf(owner, repo);
      const verdict = deployFreshness({
        tipSha: tip.sha,
        tipCommittedAt: tip.committedAt,
        deployRuns: deployRunsOf(owner, repo),
        now,
      });
      rows.push({ repo, tip: short(tip.sha), ...verdict });
    } catch (e) {
      rows.push({ repo, tip: "?", state: FRESHNESS.UNKNOWN, reason: `could not read: ${e.message}` });
    }
  }

  const order = { stale: 0, unknown: 1, pending: 2, deployed: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.repo.localeCompare(b.repo));

  console.log(`deploy-freshness: ${rows.length} repo(s) with a deploy workflow`);
  const mark = { deployed: "✓", pending: "·", stale: "✗", unknown: "?" };
  for (const r of rows) {
    console.log(`  ${mark[r.state]} ${r.repo.padEnd(22)} ${r.tip.padEnd(9)} ${r.state.padEnd(9)} ${r.reason}`);
  }

  const stale = rows.filter((r) => r.state === FRESHNESS.STALE);
  const unknown = rows.filter((r) => r.state === FRESHNESS.UNKNOWN);
  console.log();
  if (unknown.length) {
    console.log(`  ${unknown.length} repo(s) could not be judged — that is not the same as clean:`);
    for (const r of unknown) console.log(`      ${r.repo}: ${r.reason}`);
  }
  if (stale.length === 0) {
    console.log("✓ every deploying repo has its main tip live (or is inside the reconciler window).");
    return;
  }
  console.log(`✗ ${stale.length} repo(s) merged but NOT LIVE:`);
  for (const r of stale) console.log(`      ${r.repo} — ${r.reason}`);
  console.log();
  console.log("  Most commits here never fire their own Deploy; the auto-merge sweep");
  console.log("  reconciles every 10 minutes. A repo stuck here means that reconciler");
  console.log("  is not running — check auto-merge.yml still passes `deploy_workflow`.");
  if (check) process.exit(1);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
