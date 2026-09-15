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

/**
 * `gh`, with retries.
 *
 * This audit makes dozens of sequential API calls and the network is not
 * reliable: a single `unexpected EOF` used to be swallowed into an empty run
 * list, which the verdict then read as "no successful Deploy run on record" —
 * a COULD-NOT-LOOK reported as a fact about the repo. loki and aoz-housing were
 * both flagged that way while having 2 and 9 successful deploys respectively.
 */
export function gh(args, { attempts = 3 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return execFileSync("gh", args, {
        encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024,
        // CAPTURE stderr rather than letting it through. execFileSync forwards
        // the child's stderr to ours by default, so probing 21 repos for a
        // .github/workflows directory printed eight bare `gh: Not Found (HTTP
        // 404)` lines above the report — expected misses, indistinguishable
        // from a real failure, and noisy enough to hide one. Captured, they
        // reach the retry predicate and the COULD NOT READ row instead.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      last = e;
      const msg = String(e.stderr || e.message || "");
      // Only retry transport failures. A 404 is an answer; retrying it is waste.
      if (!/EOF|timeout|timed out|reset by peer|dial tcp|connection refused|502|503|504/i.test(msg)) break;
    }
  }
  throw last;
}

/**
 * Is this deploy-named workflow actually a deployer?
 *
 * Two wrong answers were tried before this one, and the order matters.
 *
 * Name alone (/deploy/i) was too WIDE: this audit's own
 * `deploy-freshness.yml` matched, so the fleet repo — which deploys nothing —
 * was reported as a deploying repo with no successful deploy.
 *
 * Requiring the content to call `selfhost-deploy.yml` or `deploy.sh` was too
 * NARROW, and failed on the most important repo: loki's own deploy.yml ships
 * inline (checkout, build, rsync) and matched neither, so the control plane
 * itself was excluded while holding seven successful deploys.
 *
 * A false negative is the worse direction — a missed deployer is a repo nobody
 * is checking — so the rule is now: include by name, and exclude only what is
 * PROVEN not to deploy. Today that is exactly one thing, this audit itself.
 */
const NOT_A_DEPLOYER = /deploy-freshness-audit|deploy-freshness\.yml/;

/**
 * The whole decision, as a pure function, because I got it wrong twice and a
 * heuristic nobody can test is a heuristic that will be wrong a third time.
 *
 * `body` is null when the file could not be read.
 */
export function isDeployerSource(file, body) {
  // A `.disabled` file is not a workflow: GitHub does not run it, and asking
  // the API for its runs 404s. datacat's deploy.yml.disabled matched /deploy/i
  // and took the whole repo out of the audit with an unreadable error.
  if (!/\.ya?ml$/.test(file)) return false;
  // Unreadable. Keep it: an unreadable candidate that IS a deployer must not
  // silently drop its repo out of the audit. Erring loud beats erring quiet.
  if (body == null) return true;
  return !NOT_A_DEPLOYER.test(body);
}

function isDeployWorkflow(owner, repo, file) {
  if (!/\.ya?ml$/.test(file)) return false; // do not spend a request on it
  let body = null;
  try {
    body = Buffer.from(
      JSON.parse(gh(["api", `repos/${owner}/${repo}/contents/.github/workflows/${file}`, "--jq", "{c: .content}"])).c,
      "base64",
    ).toString("utf8");
  } catch {
    /* leave body null — isDeployerSource decides what that means */
  }
  return isDeployerSource(file, body);
}

/** Repos that actually have a deploy workflow — the only ones this can judge. */
export function reposWithDeploy(owner, limit) {
  const all = JSON.parse(
    gh(["repo", "list", owner, "--limit", String(limit), "--no-archived",
        "--json", "name,isFork,defaultBranchRef"]),
  ).filter((r) => !r.isFork);

  const out = [];
  for (const r of all) {
    // The default branch is per-repo: aoz-housing and sbb-fundbuero are on
    // `master`. Hardcoding `main` asked for runs on a branch that does not
    // exist there, got none back, and reported both as never deployed.
    const branch = r.defaultBranchRef?.name || "main";
    try {
      const files = JSON.parse(
        gh(["api", `repos/${owner}/${r.name}/contents/.github/workflows`, "--jq", "[.[].name]"]),
      );
      const deployFiles = files
        .filter((f) => /deploy/i.test(f))
        .filter((f) => isDeployWorkflow(owner, r.name, f));
      if (deployFiles.length) out.push({ name: r.name, branch, deployFiles });
    } catch {
      /* no workflows directory: not a deploying repo */
    }
  }
  return out;
}

export function tipOf(owner, repo, branch) {
  const c = JSON.parse(
    gh(["api", `repos/${owner}/${repo}/commits?per_page=1&sha=${encodeURIComponent(branch)}`, "--jq",
        "[.[0].sha, .[0].commit.committer.date]"]),
  );
  return { sha: c[0], committedAt: c[1] };
}

/**
 * A repo's Deploy runs — asked of the DEPLOY WORKFLOW, not of a window of all
 * runs.
 *
 * The first version read `actions/runs?per_page=40` and filtered by name. On a
 * busy repo that window is entirely CI and auto-merge runs, so a perfectly
 * healthy Deploy from two days ago falls off the end and the repo reports
 * "no successful Deploy run on record". Measured immediately: aoz-housing was
 * flagged UNKNOWN while its newest Deploy was green.
 *
 * A window is not an absence. Scoping the query to each deploy workflow's own
 * runs makes the answer independent of how chatty the rest of the repo is.
 */
export function deployRunsOf(owner, repo, workflowFiles, branch) {
  const runs = [];
  for (const file of workflowFiles) {
    // Deliberately NOT swallowed. A workflow with no runs returns an empty
    // array from the API; only a genuine read failure throws, and the caller
    // must be able to tell those apart or a flaky network reads as a verdict.
    runs.push(...JSON.parse(
      gh(["api", `repos/${owner}/${repo}/actions/workflows/${file}/runs?branch=${encodeURIComponent(branch)}&per_page=20`,
          "--jq",
          "[.workflow_runs[] | {headSha: .head_sha, status, conclusion, createdAt: .created_at}]"]),
    ));
  }
  return runs;
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
  for (const { name: repo, branch, deployFiles } of repos) {
    try {
      const tip = tipOf(owner, repo, branch);
      const verdict = deployFreshness({
        tipSha: tip.sha,
        tipCommittedAt: tip.committedAt,
        deployRuns: deployRunsOf(owner, repo, deployFiles, branch),
        now,
      });
      rows.push({ repo, tip: short(tip.sha), ...verdict });
    } catch (e) {
      rows.push({
        repo, tip: "?", state: FRESHNESS.UNKNOWN,
        reason: `COULD NOT READ (not a verdict): ${String(e.message).split("\n")[0].slice(0, 90)}`,
      });
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
