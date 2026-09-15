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
 * consequence that day: reparaturbonus-zh, a concept site, sat merged-but-not-
 * live for four hours because its Deploy lost a timing race at 05:56 and
 * nothing retried it. CI was green, /api/health was 200, and the box served the
 * previous release the whole time.
 *
 * Quiet repos are hit worst, which is exactly backwards: GitHub de-prioritises
 * schedules on low-activity repos, and a pilot or concept site nobody pushes to
 * all week is the definition of low-activity. The repos least likely to be
 * watched by a human are the ones whose clock stops first.
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

/**
 * How many CI re-runs one tick may start. Lower than the deploy cap on purpose:
 * a predicate bug here would re-run CI across the org every half hour forever,
 * and unlike a stalled deploy nothing about that is self-limiting.
 */
export const MAX_RERUNS = 3;

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
 * Should this repo's CI be re-run?
 *
 * The case: a tip is STALE and has NO green CI run at all, because concurrency
 * cancelled every run it had. Observed on loki 2026-09-15 — two cancelled CI
 * runs, and therefore SIX Deploy runs that all `skipped`, because the chained
 * trigger requires `workflow_run.conclusion == 'success'`. The tip sat
 * unshipped for over two hours and would have sat there indefinitely: nothing
 * in the fleet re-runs a cancelled CI, so the green run the chain waits for
 * could never appear.
 *
 * shouldDispatch deliberately refuses to deploy this, and that refusal is
 * right — shipping an unverified tip to clear a stalled deploy turns a stall
 * into a bad release. But refusing is not repairing, and a reconciler that only
 * ever declines leaves the repo exactly as stuck as it found it.
 *
 * Re-running CI is the remedy that matches the fault, and it is a categorically
 * cheaper action than deploying: it publishes nothing, changes nothing on the
 * box, and is idempotent. If it goes green the ordinary chain ships the tip; if
 * it goes red, the tip SHOULD be stuck and now says so out loud.
 */
export function needsCiRerun({ state, ci, ciInFlight }) {
  if (state !== FRESHNESS.STALE) return { rerun: false, reason: `not stale (${state})` };
  // Only the no-green-run case. A RED tip is not repaired by running it again —
  // that is a broken build, and re-running it in a loop is how a reconciler
  // becomes a CI amplifier.
  if (ci !== "none") return { rerun: false, reason: `CI verdict is ${ci}, not a missing green run` };
  if (ciInFlight) return { rerun: false, reason: "a CI run is already in flight" };
  return { rerun: true, reason: "no green CI run exists for the tip — re-running CI, not deploying" };
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

/**
 * Was this exact commit deployed, according to the run index keyed by COMMIT?
 *
 * This exists because re-reading the same endpoint twice was not enough.
 *
 * `actions/workflows/{file}/runs?branch=main` intermittently returns a page
 * that omits its own newest runs. Measured 2026-09-15: it happened to datacat
 * twice and to evig once inside ninety minutes, and on evig it got past the
 * double-read guard and dispatched a real, redundant deploy of a tip that had
 * been live since 05:42. Reading a flaky endpoint twice mostly gives you the
 * same flake twice; it is not independent evidence.
 *
 * `actions/runs?head_sha=<sha>` is a DIFFERENT index — keyed by commit rather
 * than by workflow and branch — and answers the question actually being asked:
 * has this commit had a successful deploy run? On evig it returned the
 * deploy-selfhost.yml success that the other endpoint had just denied.
 *
 * Runs carry `path` (".github/workflows/deploy-selfhost.yml"), so the file is
 * compared by basename against the repo's known deploy workflows.
 */
export function deployedByShaIndex(runsForSha, deployFiles) {
  const want = new Set((deployFiles ?? []).map((f) => String(f).toLowerCase()));
  return (runsForSha ?? []).some(
    (r) =>
      r &&
      r.status === "completed" &&
      r.conclusion === "success" &&
      want.has(String(r.path ?? "").split("/").pop().toLowerCase()),
  );
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
function runsForSha(owner, repo, sha) {
  try {
    return JSON.parse(
      gh(["api", `repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100`, "--jq",
          "[.workflow_runs[] | {path, status, conclusion}]"]),
    );
  } catch {
    return null; // unreadable: deployedByShaIndex(null) is false, so it does not
                 // manufacture a confirmation either way
  }
}

export function confirmedStale(owner, repo, branch, deployFiles, now) {
  try {
    const tip = tipOf(owner, repo, branch);

    // The independent check first, because it is the one that caught the case
    // the re-read missed. If the commit index knows of a successful deploy for
    // this exact tip, the tip is live and nothing else needs deciding.
    if (deployedByShaIndex(runsForSha(owner, repo, tip.sha), deployFiles)) {
      return { ok: false, state: "deployed (a run for this commit exists in the head_sha index)" };
    }

    const runs = deployRunsOf(owner, repo, deployFiles, branch);
    const { state } = deployFreshness({
      tipSha: tip.sha, tipCommittedAt: tip.committedAt, deployRuns: runs, now,
    });
    return { ok: state === FRESHNESS.STALE, state };
  } catch (e) {
    // Could not re-read. That is not a confirmation, so it is not a deploy.
    return { ok: false, state: `re-check failed: ${String(e.message).split("\n")[0].slice(0, 60)}` };
  }
}

/**
 * The repo's CI workflow file.
 *
 * Not assumed to be `ci.yml`. The sweep takes it as a per-repo input precisely
 * because it varies, and a hardcoded name would silently re-run nothing in the
 * repos that spell it differently — the same shape as hardcoding `main` as the
 * default branch, which reported two repos as never deployed.
 */
function ciWorkflowOf(owner, repo) {
  try {
    const files = JSON.parse(
      gh(["api", `repos/${owner}/${repo}/contents/.github/workflows`, "--jq", "[.[].name]"]),
    ).filter((f) => /\.ya?ml$/.test(f));
    // Prefer a file literally named ci, then one whose `name:` is CI.
    const exact = files.find((f) => /^ci\.ya?ml$/i.test(f));
    if (exact) return exact;
    for (const f of files) {
      try {
        const body = Buffer.from(
          JSON.parse(gh(["api", `repos/${owner}/${repo}/contents/.github/workflows/${f}`, "--jq", "{c: .content}"])).c,
          "base64",
        ).toString("utf8");
        if (/^name:\s*["']?CI["']?\s*$/m.test(body)) return f;
      } catch { /* unreadable candidate, try the next */ }
    }
  } catch { /* no workflows directory */ }
  return null;
}

function ciInFlightFor(checkRuns) {
  return (checkRuns ?? []).some((r) => r.status !== "completed");
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
      const checks = state === FRESHNESS.STALE ? checkRunsFor(owner, repo, tip.sha) : null;
      const ci = state === FRESHNESS.STALE ? ciVerdict(checks) : "green";
      const d = shouldDispatch({ state, ci, deployInFlight: deployInFlight(runs) });
      const r = needsCiRerun({ state, ci, ciInFlight: ciInFlightFor(checks) });
      decisions.push({
        repo, branch, tip: tip.sha.slice(0, 7), file: deployFiles[0], files: deployFiles,
        state, ci, rerun: r.rerun, rerunReason: r.reason, ...d,
      });
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

  // Repairs that are not deploys. Done BEFORE the deploy block returns early,
  // or a fleet with nothing to ship would never re-run anything.
  const reruns = decisions.filter((d) => d.rerun);
  if (reruns.length > MAX_RERUNS) {
    console.error();
    console.error(`✗ ${reruns.length} repos want a CI re-run, over the cap of ${MAX_RERUNS}. Re-running NONE.`);
    for (const d of reruns) console.error(`      ${d.repo} ${d.tip}`);
    process.exitCode = 1;
  } else if (reruns.length) {
    console.log();
    for (const d of reruns) {
      const file = ciWorkflowOf(owner, d.repo);
      if (!file) {
        console.log(`  ? no CI workflow  ${d.repo.padEnd(22)} cannot re-run what cannot be found`);
        continue;
      }
      if (!go) {
        console.log(`  would re-run CI ${d.repo.padEnd(22)} ${file} @ ${d.branch} (${d.tip})`);
        continue;
      }
      try {
        dispatch(owner, d.repo, file, d.branch);
        console.log(`  ✓ re-ran CI     ${d.repo.padEnd(22)} ${file} @ ${d.branch} (${d.tip})`);
      } catch (e) {
        console.error(`  ✗ RERUN FAILED  ${d.repo.padEnd(22)} ${String(e.message).split("\n")[0].slice(0, 80)}`);
        process.exitCode = 1;
      }
    }
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
