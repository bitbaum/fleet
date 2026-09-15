#!/usr/bin/env node
/**
 * One clock for the whole fleet's deploys.
 *
 * WHY THIS EXISTS
 *
 * The reconciler logic is not missing and is not broken. `auto-merge-sweep.sh`
 * already compares the base tip against the last successful deploy and closes
 * the gap, with a green guard and an in-flight guard, and it is already
 * centralised as a reusable workflow. What is broken is its CLOCK.
 *
 * Each caller repo supplies its own `schedule:`, so the fleet depends on ~25
 * independent GitHub crons. GitHub does not honour them. Measured 2026-09-15,
 * time since each repo's sweep last ran:
 *
 *     loki 19m · evig 151m · reparaturbonus-zh 244m · vitareba 276m
 *
 * A ten-minute cron that last fired four hours ago is not a reconciler. The visible
 * consequence that day: reparaturbonus-zh, a client site, sat merged-but-not-
 * live for four hours because its Deploy lost a timing race at 05:56 and
 * nothing retried it. CI was green, /api/health was 200, and the box served the
 * previous release the whole time.
 *
 * Quiet repos are hit worst, which is exactly backwards: GitHub de-prioritises
 * schedules on low-activity repos, and a client site nobody pushes to all week
 * is the definition of low-activity. The repos least likely to be watched by a
 * human are the ones whose clock stops first.
 *
 * So: one scheduler, in the most active repo in the org, dispatching deploys
 * for the repos that actually need one. It does not reimplement the sweep and
 * it does not merge anything — it only closes the merged-but-not-live gap.
 *
 * WHAT IT WILL AND WILL NOT DO
 *
 * It dispatches only where the tip is STALE by the same predicate the audit
 * uses (so the two cannot drift), the tip's CI is GREEN, and no deploy is
 * already in flight.
 *
 * It deliberately does NOT dispatch a repo whose tip is stale because CI never
 * went green — cancelled, failed, or still running. That is a different
 * failure needing a different fix (loki, the same day: both CI runs cancelled
 * by concurrency, so all six chained Deploy runs skipped). Shipping a tip whose
 * CI is not green to "fix" it would turn a stalled deploy into a bad one.
 *
 *   node scripts/ci/deploy-reconciler.mjs         # report only — the DEFAULT
 *   node scripts/ci/deploy-reconciler.mjs --go    # actually dispatch
 */

import { execFileSync } from "node:child_process";
import {
  deployFreshness,
  reposWithDeploy,
  tipOf,
  deployRunsOf,
  gh,
  FRESHNESS,
} from "./deploy-freshness-audit.mjs";

/**
 * How many repos one tick may ship. A reconciler holds a dispatch button for
 * every repo in the org; a bug in the staleness predicate would press all of
 * them at once. Past the cap it reports and ships nothing, which is the failure
 * direction a human can still undo.
 */
export const MAX_DISPATCHES = 5;

export const ACTION = {
  DISPATCH: "dispatch",
  SKIP: "skip",
};

/**
 * Should this repo be shipped right now?
 *
 * Pure, because it is the only part that can cause a deploy, and a decision
 * that causes deploys across 21 repos should not be readable only by running
 * it against production.
 *
 * `ci` is the tip's combined check verdict: "green", "red", "pending" or
 * "none".
 */
export function shouldDispatch({ state, ci, deployInFlight }) {
  if (state !== FRESHNESS.STALE) {
    return { action: ACTION.SKIP, reason: `not stale (${state})` };
  }
  // The sweep's own guard, kept here for the same reason it exists there:
  // dispatching a second deploy while one is mid-flight is how a release
  // overwrites a newer one.
  if (deployInFlight) {
    return { action: ACTION.SKIP, reason: "a deploy is already in flight" };
  }
  if (ci === "red") {
    return { action: ACTION.SKIP, reason: "tip CI is RED — shipping it would deploy a known-broken build" };
  }
  if (ci === "pending") {
    return { action: ACTION.SKIP, reason: "tip CI has not finished — the chained deploy may still fire on its own" };
  }
  if (ci === "none") {
    // This is loki's case, and it is worth naming rather than silently
    // skipping: every CI run for the tip was CANCELLED, so no green run exists
    // for the chained trigger to fire on, and no deploy will ever happen.
    return {
      action: ACTION.SKIP,
      reason: "stale with NO green CI run for the tip — needs a CI re-run, not a deploy",
    };
  }
  return { action: ACTION.DISPATCH, reason: "tip is green, stale, and nothing is in flight" };
}

/**
 * Collapse a commit's check runs into one verdict.
 *
 * "No completed run" and "a completed run that failed" are different answers
 * and must not collapse together — the first means nobody looked, the second
 * means somebody looked and it was broken.
 */
export function ciVerdict(checkRuns) {
  const runs = checkRuns ?? [];
  if (runs.some((r) => r.status !== "completed")) return "pending";
  const done = runs.filter((r) => r.status === "completed");
  if (done.length === 0) return "none";
  if (done.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "red";
  // `cancelled` is not a pass. Concurrency cancels CI runs routinely here, and
  // reading a cancelled run as green is precisely how a broken tip ships.
  const green = done.filter((r) => r.conclusion === "success" || r.conclusion === "skipped" || r.conclusion === "neutral");
  if (green.length === 0) return "none";
  return "green";
}

// ── live data ───────────────────────────────────────────────────────────────

function checkRunsFor(owner, repo, sha) {
  try {
    return JSON.parse(
      gh(["api", `repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, "--jq",
          "[.check_runs[] | {status, conclusion}]"]),
    );
  } catch {
    return null; // unreadable — ciVerdict(null) is "none", which never ships
  }
}

function deployInFlight(runs) {
  return (runs ?? []).some((r) => r.status !== "completed");
}

/**
 * Ask again before shipping.
 *
 * Observed 2026-09-15: two dry runs twenty-five minutes apart disagreed about
 * datacat. The second called it STALE and would have dispatched a deploy; the
 * same code path, re-run immediately afterwards against the same unchanged tip,
 * said DEPLOYED — and the tip did have a successful Deploy run for its exact
 * SHA, from 05:22 that morning. Nothing about the repo changed between the
 * three reads.
 *
 * The likeliest mechanism is the one behind every other bug in this pair of
 * files: `actions/workflows/{file}/runs` is eventually consistent, and a reply
 * from a lagging replica that omits the newest run is indistinguishable from a
 * repo that never deployed. A window is not an absence; neither is a stale
 * replica.
 *
 * A wrong STALE costs a redundant deploy of a repo that is already live, which
 * on a client site is a real production event triggered by a phantom. So the
 * verdict has to survive being asked twice. Two reads is not a proof — a
 * replica can lag twice — but it converts a common transient into a rare one,
 * and the cost of asking is one API call per repo actually being shipped.
 */
export function confirmedStale(owner, repo, branch, deployFiles, now) {
  try {
    const runs = deployRunsOf(owner, repo, deployFiles, branch);
    const tip = tipOf(owner, repo, branch);
    const { state } = deployFreshness({
      tipSha: tip.sha, tipCommittedAt: tip.committedAt, deployRuns: runs, now,
    });
    return { ok: state === FRESHNESS.STALE, state };
  } catch (e) {
    // Could not re-read. That is not a confirmation, so it is not a deploy.
    return { ok: false, state: `re-check failed: ${String(e.message).split("\n")[0].slice(0, 60)}` };
  }
}

function dispatch(owner, repo, workflowFile, branch) {
  execFileSync("gh", ["workflow", "run", workflowFile, "--repo", `${owner}/${repo}`, "--ref", branch], {
    encoding: "utf8", timeout: 60000,
  });
}

function main() {
  const owner = process.env.GH_OWNER || "bitbaum";
  const limit = Number(process.env.GH_LIMIT || 200);
  const go = process.argv.includes("--go");
  const now = new Date().toISOString();

  const repos = reposWithDeploy(owner, limit);
  if (repos.length === 0) {
    // Same rule as the audit: a tick that surveyed nothing is not a clean tick.
    console.error("⊘ deploy-reconciler SKIPPED — no repos with a deploy workflow were found.");
    process.exit(1);
  }

  const decisions = [];
  for (const { name: repo, branch, deployFiles } of repos) {
    try {
      const tip = tipOf(owner, repo, branch);
      const runs = deployRunsOf(owner, repo, deployFiles, branch);
      const { state } = deployFreshness({
        tipSha: tip.sha, tipCommittedAt: tip.committedAt, deployRuns: runs, now,
      });

      // Only pay for the check-runs call where it can change the answer.
      const ci = state === FRESHNESS.STALE ? ciVerdict(checkRunsFor(owner, repo, tip.sha)) : "green";
      const d = shouldDispatch({ state, ci, deployInFlight: deployInFlight(runs) });
      decisions.push({ repo, branch, tip: tip.sha.slice(0, 7), file: deployFiles[0], files: deployFiles, state, ci, ...d });
    } catch (e) {
      decisions.push({
        repo, branch, tip: "?", state: FRESHNESS.UNKNOWN, ci: "none", action: ACTION.SKIP,
        reason: `COULD NOT READ (not a verdict): ${String(e.message).split("\n")[0].slice(0, 80)}`,
      });
    }
  }

  const wanted = decisions.filter((d) => d.action === ACTION.DISPATCH);
  console.log(`deploy-reconciler: surveyed ${decisions.length} repo(s), ${wanted.length} need shipping${go ? "" : "  [DRY RUN — pass --go to dispatch]"}`);

  // Anything that is stale but NOT being shipped is the interesting output:
  // it is a repo stuck in a way this tool deliberately will not paper over.
  const stuck = decisions.filter((d) => d.state === FRESHNESS.STALE && d.action === ACTION.SKIP);
  if (stuck.length) {
    console.log();
    console.log(`  ${stuck.length} repo(s) STALE but not shippable by this tool:`);
    for (const d of stuck) console.log(`      ${d.repo.padEnd(22)} ${d.reason}`);
  }

  if (wanted.length === 0) {
    console.log();
    console.log("✓ nothing to reconcile — every deploying repo's tip is live or in flight.");
    return;
  }

  if (wanted.length > MAX_DISPATCHES) {
    console.error();
    console.error(`✗ ${wanted.length} repos want a deploy, over the cap of ${MAX_DISPATCHES}. Dispatching NONE.`);
    console.error("  A whole fleet going stale at once is far more likely to be a bug in this");
    console.error("  predicate than 21 genuinely stalled deploys. Look before shipping:");
    for (const d of wanted) console.error(`      ${d.repo} ${d.tip} — ${d.reason}`);
    process.exit(1);
  }

  console.log();
  for (const d of wanted) {
    // Ask again, immediately before acting. See confirmedStale.
    const again = confirmedStale(owner, d.repo, d.branch, d.files, new Date().toISOString());
    if (!again.ok) {
      console.log(`  ~ not confirmed ${d.repo.padEnd(22)} first read said stale, second said ${again.state} — NOT shipping`);
      continue;
    }
    if (!go) {
      console.log(`  would dispatch  ${d.repo.padEnd(22)} ${d.file} @ ${d.branch} (${d.tip})`);
      continue;
    }
    try {
      dispatch(owner, d.repo, d.file, d.branch);
      console.log(`  ✓ dispatched    ${d.repo.padEnd(22)} ${d.file} @ ${d.branch} (${d.tip})`);
    } catch (e) {
      // Do not print a success line for a failed dispatch. An `echo` after an
      // unchecked `gh workflow run` is how a network timeout got reported as a
      // ship on 2026-09-15.
      console.error(`  ✗ FAILED        ${d.repo.padEnd(22)} ${String(e.message).split("\n")[0].slice(0, 80)}`);
      process.exitCode = 1;
    }
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
