#!/usr/bin/env node
/**
 * Wake the auto-merge sweeps that have something to merge.
 *
 * WHY THIS EXISTS
 *
 * A shared-package PR is held by the rollout gate until its canary has deployed
 * the artifact and passed its checks. Nothing wakes the held PR's sweep when
 * that happens: a sweep runs on a CI completion in its OWN repo, or on its
 * hourly `schedule:`, and GitHub does not honour schedules (heidi's sweeps ran
 * 15:28, 18:29, 20:45 with nothing in between, 2026-10-26). So a PR the gate
 * cleared at minute 10 waited for the next random CI completion — 42 to 131
 * minutes measured on six PRs, and 11 hours on two (CI speed audit,
 * 2026-10-27).
 *
 * Two callers, one script:
 *   - `sweep-wake.yml`, called by a canary when its Deploy or browser smoke
 *     finishes green — the event that actually clears the gate;
 *   - `deploy-reconciler.yml`, which the box's timer fires every 15 minutes
 *     (the one clock here that does fire) — so a missed event is a short wait,
 *     not an indefinite one, and the per-repo hourly cron stops being load-bearing.
 *
 * WHAT IT DOES NOT DO
 *
 * It decides nothing about merging. It dispatches the repo's own
 * `auto-merge.yml`, which runs the one sweep policy: one PR at a time, only onto
 * a green main, holds, the docs gate and the rollout gate all still apply. It
 * only dispatches where a non-draft PR is open and no sweep is already queued
 * or running, and it is capped per tick.
 *
 *   node scripts/ci/sweep-wake.mjs         # report only — the DEFAULT
 *   node scripts/ci/sweep-wake.mjs --go    # dispatch
 *
 * Env: OWNER (default bitbaum), WAKE_SKIP (space-separated owner/repo to leave
 * alone), GH_TOKEN (needs actions: write across the org — FLEET_PAT).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gh } from "./deploy-freshness-audit.mjs";

/** A bug here must not press a dispatch button in every repo of the org. */
export const MAX_WAKES = 25;

const SWEEP_WORKFLOW = "auto-merge.yml";

/**
 * Which repos should be woken. Pure — it is the only part that can dispatch.
 *
 * `repos`: [{ name, branch, openPrs, sweepActive }] where openPrs counts
 * non-draft open PRs that change dependencies and sweepActive says an Auto-merge run is queued or
 * running. `skip`: Set of "owner/name".
 */
export function chooseWakeTargets({ owner, repos, skip = new Set(), cap = MAX_WAKES }) {
  const picked = [];
  const left = [];
  for (const r of repos) {
    const full = `${owner}/${r.name}`;
    if (skip.has(full)) { left.push({ repo: full, why: "skipped by WAKE_SKIP" }); continue; }
    if (!r.openPrs) { left.push({ repo: full, why: "no open dependency PR" }); continue; }
    if (r.sweepActive) { left.push({ repo: full, why: "a sweep is already queued or running" }); continue; }
    picked.push({ repo: full, branch: r.branch, openPrs: r.openPrs });
  }
  if (picked.length > cap) {
    return { wake: [], left, overCap: picked.length };
  }
  return { wake: picked, left, overCap: 0 };
}

const QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number
      repository { name defaultBranchRef { name } }
      files(first: 100) { nodes { path } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

/** A PR the rollout gate can hold: one that touches a manifest or a lockfile. */
export const touchesDependencies = (paths) =>
  paths.some((p) => /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(p));

/**
 * ONE org-wide search for open non-draft PRs and the files they touch, instead
 * of a request per repo (that took over two minutes — as long as the wait it is
 * here to remove). Only a green PR that changes dependencies can be held by
 * the rollout gate, so only those are worth waking a sweep for.
 */
function candidateRepos(owner) {
  const byRepo = new Map();
  let after = null;
  for (let page = 0; page < 5; page++) {
    const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=org:${owner} is:pr is:open draft:false archived:false`];
    if (after) args.push("-f", `after=${after}`);
    const { search } = JSON.parse(gh(args)).data;
    for (const pr of search.nodes) {
      if (!pr?.repository) continue;
      if (!touchesDependencies((pr.files?.nodes ?? []).map((f) => f.path))) continue;
      // Green and still open is exactly "something other than CI is holding it"
      // — the rollout gate, the one-at-a-time rule, a hold. A PR whose checks
      // are red or running has nothing a wake can change.
      if (pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state !== "SUCCESS") continue;
      const name = pr.repository.name;
      const r = byRepo.get(name) ?? { name, branch: pr.repository.defaultBranchRef?.name || "main", openPrs: 0 };
      r.openPrs++;
      byRepo.set(name, r);
    }
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return [...byRepo.values()];
}

const run = promisify(execFile);

async function sweepActive(owner, name) {
  try {
    const { stdout } = await run("gh", ["api", `repos/${owner}/${name}/actions/workflows/${SWEEP_WORKFLOW}/runs?per_page=5`, "--jq",
      "[.workflow_runs[] | {status}]"], { encoding: "utf8", timeout: 60000 });
    return JSON.parse(stdout).some((r) => r.status !== "completed");
  } catch {
    return true; // no such workflow, or unreadable: nothing to dispatch
  }
}

async function main() {
  const go = process.argv.includes("--go");
  const owner = process.env.OWNER || "bitbaum";
  const skip = new Set((process.env.WAKE_SKIP || "").split(/\s+/).filter(Boolean));

  const repos = candidateRepos(owner);
  await Promise.all(repos.map(async (r) => { r.sweepActive = await sweepActive(owner, r.name); }));

  const { wake, left, overCap } = chooseWakeTargets({ owner, repos, skip });
  for (const l of left.filter((x) => x.why !== "no open dependency PR")) console.log(`skip ${l.repo}: ${l.why}`);
  if (overCap) {
    console.log(`REFUSING: ${overCap} repos would be woken, over the cap of ${MAX_WAKES} — a predicate bug looks like this.`);
    process.exit(0);
  }
  if (!wake.length) { console.log("no sweep needs waking"); return; }

  let failed = 0;
  for (const w of wake) {
    if (!go) { console.log(`would wake ${w.repo} (${w.openPrs} open PR(s))`); continue; }
    try {
      gh(["workflow", "run", SWEEP_WORKFLOW, "--repo", w.repo, "--ref", w.branch]);
      console.log(`woke ${w.repo} (${w.openPrs} open PR(s))`);
    } catch (e) {
      failed++;
      console.log(`could not wake ${w.repo}: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    }
  }
  // A repo without a dispatchable auto-merge.yml is a finding, not an outage.
  if (go && failed === wake.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
