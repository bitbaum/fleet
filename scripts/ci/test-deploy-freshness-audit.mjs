#!/usr/bin/env node
/**
 * Self-test for deploy-freshness-audit.mjs. No network, no gh, no checkout.
 *
 * Both directions on every fixture. The one that matters most is the NEGATIVE
 * one: most commits in this fleet never get a Deploy run of their own — they
 * ride a later reconciler dispatch — so an audit that demanded an exact-SHA run
 * would report nearly every repo stale while everything was in fact live. A
 * check that cries wolf gets muted, and then it protects nothing.
 */

import { deployFreshness, isDeployerSource, deployedByShaIndex, missingFrom, newlyDeploying, readBaseline, FRESHNESS, GRACE_MINUTES } from "./deploy-freshness-audit.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.error(`  ✗ ${m}`); };
const eq = (got, want, m) =>
  got === want ? ok(m) : bad(`${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const NOW = "2026-09-15T12:00:00Z";
const run = (o) => ({ status: "completed", conclusion: "success", ...o });

console.log("test-deploy-freshness-audit");

// ── deployed: a run for this exact commit ───────────────────────────────────
eq(
  deployFreshness({
    tipSha: "abc123", tipCommittedAt: "2026-09-15T11:00:00Z", now: NOW,
    deployRuns: [run({ headSha: "abc123", createdAt: "2026-09-15T11:05:00Z" })],
  }).state,
  FRESHNESS.DEPLOYED,
  "a successful run for the tip SHA is deployed",
);

// ── deployed: the reconciler case, which is the COMMON one here ─────────────
eq(
  deployFreshness({
    tipSha: "abc123", tipCommittedAt: "2026-09-15T11:00:00Z", now: NOW,
    deployRuns: [run({ headSha: "different", createdAt: "2026-09-15T11:12:00Z" })],
  }).state,
  FRESHNESS.DEPLOYED,
  "a later successful deploy covers a tip that never had its own run",
);

// ── stale: the failure this audit exists for ────────────────────────────────
{
  const v = deployFreshness({
    tipSha: "abc123", tipCommittedAt: "2026-09-15T09:00:00Z", now: NOW,
    deployRuns: [run({ headSha: "older", createdAt: "2026-09-15T08:00:00Z" })],
  });
  eq(v.state, FRESHNESS.STALE, "a tip older than the window with no deploy since it is STALE");
  /180m|no deploy has run since/.test(v.reason)
    ? ok("and the reason says how long it has been undeployed")
    : bad(`the stale reason was unhelpful: ${v.reason}`);
}

// ── pending: inside the reconciler window, not yet a finding ────────────────
eq(
  deployFreshness({
    tipSha: "abc123", tipCommittedAt: "2026-09-15T11:50:00Z", now: NOW,
    deployRuns: [run({ headSha: "older", createdAt: "2026-09-15T11:00:00Z" })],
  }).state,
  FRESHNESS.PENDING,
  "a tip merged 10m ago is pending, not stale — the sweep runs every 10m",
);

// The grace boundary, both sides, so the window cannot silently become "never".
eq(
  deployFreshness({
    tipSha: "x", tipCommittedAt: new Date(Date.parse(NOW) - (GRACE_MINUTES - 1) * 60000).toISOString(),
    now: NOW, deployRuns: [run({ headSha: "old", createdAt: "2026-09-15T00:00:00Z" })],
  }).state,
  FRESHNESS.PENDING,
  `just inside ${GRACE_MINUTES}m is pending`,
);
eq(
  deployFreshness({
    tipSha: "x", tipCommittedAt: new Date(Date.parse(NOW) - (GRACE_MINUTES + 1) * 60000).toISOString(),
    now: NOW, deployRuns: [run({ headSha: "old", createdAt: "2026-09-15T00:00:00Z" })],
  }).state,
  FRESHNESS.STALE,
  `just outside ${GRACE_MINUTES}m is stale`,
);

// ── unknown must never read as clean ────────────────────────────────────────
eq(
  deployFreshness({ tipSha: "x", tipCommittedAt: "2026-09-15T09:00:00Z", now: NOW, deployRuns: [] }).state,
  FRESHNESS.UNKNOWN,
  "no runs at all is UNKNOWN, not deployed",
);
eq(
  deployFreshness({
    tipSha: "x", tipCommittedAt: "2026-09-15T09:00:00Z", now: NOW,
    deployRuns: [{ headSha: "x", status: "completed", conclusion: "failure", createdAt: "2026-09-15T11:00:00Z" }],
  }).state,
  FRESHNESS.UNKNOWN,
  "a FAILED deploy is not a deploy — it does not make the tip live",
);
eq(
  deployFreshness({
    tipSha: "x", tipCommittedAt: "2026-09-15T09:00:00Z", now: NOW,
    deployRuns: [{ headSha: "x", status: "in_progress", conclusion: null, createdAt: "2026-09-15T11:59:00Z" }],
  }).state,
  FRESHNESS.UNKNOWN,
  "a deploy still running has not deployed anything yet",
);
// A cancelled run is the documented local failure mode — it must not count.
eq(
  deployFreshness({
    tipSha: "x", tipCommittedAt: "2026-09-15T09:00:00Z", now: NOW,
    deployRuns: [{ headSha: "x", status: "completed", conclusion: "cancelled", createdAt: "2026-09-15T11:00:00Z" }],
  }).state,
  FRESHNESS.UNKNOWN,
  "a CANCELLED deploy does not count as shipped",
);

// ── the vacuous-pass guard ──────────────────────────────────────────────────
// If the predicate degraded into "always deployed", every case above still
// passes except this one.
{
  const v = deployFreshness({
    tipSha: "never-deployed", tipCommittedAt: "2026-01-01T00:00:00Z", now: NOW,
    deployRuns: [run({ headSha: "ancient", createdAt: "2025-12-31T00:00:00Z" })],
  });
  v.state === FRESHNESS.STALE
    ? ok("a months-old undeployed tip is still reported — the predicate is not 'always fine'")
    : bad(`a months-old undeployed tip returned ${v.state}`);
}

// ── which /deploy/i-named files are actually deployers ──────────────────────
//
// Two shipped versions of this predicate were wrong, in OPPOSITE directions,
// so both directions are pinned here with the real files that fooled them.
{
  // Too WIDE, v1: matching the filename alone. fleet deploys nothing, but its
  // audit workflow is spelled "deploy-freshness.yml", so fleet was reported as
  // a deploying repo with no successful deploy.
  isDeployerSource("deploy-freshness.yml", "jobs:\n  audit:\n    run: node scripts/ci/deploy-freshness-audit.mjs")
    ? bad("this audit's own workflow counted as a deployer — the v1 false positive is back")
    : ok("a workflow that only RUNS this audit is not a deployer");

  // Too NARROW, v2: requiring the body to name selfhost-deploy.yml or
  // deploy.sh. loki ships inline and matched neither, so the control plane
  // dropped out of its own audit while holding seven successful deploys.
  const lokiInline = [
    "name: Deploy",
    "on:",
    "  workflow_run:",
    "    workflows: [\"CI\"]",
    "jobs:",
    "  deploy:",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - run: pnpm build",
    "      - run: rsync -a .next/ ubuntu@box:/opt/loki/releases/$TS/",
  ].join("\n");
  isDeployerSource("deploy.yml", lokiInline)
    ? ok("an inline rsync deploy counts — loki does not drop out of its own audit")
    : bad("loki's inline deploy.yml was excluded — the v2 false negative is back");

  // datacat kept a deploy.yml.disabled. GitHub will not run it, and asking the
  // API for its runs 404s, which surfaced as an unreadable repo.
  isDeployerSource("deploy.yml.disabled", "anything at all")
    ? bad("a .disabled file counted as a live workflow")
    : ok("a .disabled workflow is not a deployer");
  isDeployerSource("deploy.yaml", "jobs:\n  deploy:\n    run: ./deploy.sh")
    ? ok(".yaml is a workflow extension too")
    : bad(".yaml was rejected");

  // An unreadable file must not quietly shrink the audit's coverage.
  isDeployerSource("deploy.yml", null)
    ? ok("an unreadable deploy workflow is KEPT — coverage must not shrink on a network blip")
    : bad("an unreadable deploy workflow was dropped, silently removing its repo from the audit");
}

// ── the coverage ratchet ────────────────────────────────────────────────────
//
// This audit once printed "✓ every deploying repo has its main tip live" over
// a run that had never looked at annushka, because the repo is PRIVATE and the
// workflow's token could not enumerate it. A repo a token cannot see is absent
// from `gh repo list` in exactly the same way as a repo that does not exist.
{
  const baseline = ["alpha", "beta", "gamma"];

  missingFrom(baseline, ["alpha", "beta", "gamma"]).length === 0
    ? ok("a full survey reports nothing missing")
    : bad("a full survey invented a missing repo");

  const gone = missingFrom(baseline, ["alpha", "gamma"]);
  gone.length === 1 && gone[0] === "beta"
    ? ok("a repo that silently dropped out of the survey is NAMED, not just counted")
    : bad(`a vanished repo was not reported: ${JSON.stringify(gone)}`);

  // The direction that actually bit: the survey shrank and every remaining row
  // was healthy. "All green" must not be reachable while coverage has fallen.
  missingFrom(baseline, []).length === 3
    ? ok("a survey that saw NOTHING reports all three missing, not a clean fleet")
    : bad("an empty survey did not report the baseline as missing");

  // Coverage rising is not a failure — it is a baseline update.
  const extra = newlyDeploying(baseline, ["alpha", "beta", "gamma", "delta"]);
  extra.length === 1 && extra[0] === "delta"
    ? ok("a newly deploying repo is surfaced so the baseline can rise")
    : bad(`a new deploying repo was not surfaced: ${JSON.stringify(extra)}`);

  newlyDeploying(baseline, ["alpha", "beta", "gamma"]).length === 0
    ? ok("no spurious additions when the survey matches the baseline")
    : bad("an addition was invented");

  // And the committed baseline must actually load — an unreadable baseline
  // silently disables the whole ratchet, which is the same class of bug again.
  const real = readBaseline();
  real.length >= 20 && real.includes("annushka") && real.includes("loki")
    ? ok(`the committed baseline loads (${real.length} repos) and includes the private repo that was being missed`)
    : bad(`the committed baseline did not load properly: ${real.length} entries`);
  real.some((l) => l.startsWith("#"))
    ? bad("comments leaked into the baseline list")
    : ok("comments and blank lines are stripped from the baseline");
}

// ── the independent confirmation, keyed by commit ───────────────────────────
//
// Re-reading the same endpoint twice was not enough. `actions/workflows/{file}/
// runs?branch=main` intermittently omits its own newest runs — datacat twice
// and evig once inside ninety minutes — and on evig that got past the
// double-read and dispatched a real, redundant deploy of a tip live since
// 05:42. Reading a flaky endpoint twice mostly gives you the same flake twice.
{
  const DEPLOYS = ["deploy-selfhost.yml"];
  const run = (path, status, conclusion) => ({ path, status, conclusion });

  // The exact shape the head_sha index returned for evig's tip.
  const evig = [
    run(".github/workflows/ci.yml", "completed", "success"),
    run(".github/workflows/auto-merge.yml", "completed", "success"),
    run(".github/workflows/deploy-selfhost.yml", "completed", "success"),
  ];
  deployedByShaIndex(evig, DEPLOYS)
    ? ok("a successful deploy run in the commit index counts as deployed — the evig false positive is caught")
    : bad("the evig case still reads as undeployed");

  // Green CI is not a deploy. This is the whole point of matching the path.
  deployedByShaIndex([run(".github/workflows/ci.yml", "completed", "success")], DEPLOYS)
    ? bad("a successful CI run was mistaken for a deploy")
    : ok("a successful CI run is not a deploy");

  deployedByShaIndex([run(".github/workflows/deploy-selfhost.yml", "completed", "failure")], DEPLOYS)
    ? bad("a FAILED deploy counted as deployed")
    : ok("a failed deploy run does not count");
  deployedByShaIndex([run(".github/workflows/deploy-selfhost.yml", "completed", "cancelled")], DEPLOYS)
    ? bad("a CANCELLED deploy counted as deployed")
    : ok("a cancelled deploy run does not count");
  deployedByShaIndex([run(".github/workflows/deploy-selfhost.yml", "in_progress", null)], DEPLOYS)
    ? bad("an in-flight deploy counted as already deployed")
    : ok("an in-flight deploy is not yet a deploy");
  // The line above is enforced by the CONCLUSION check, not the status one: a
  // non-terminal run reports conclusion null, so it fails either way. Mutating
  // `status === "completed"` therefore left the suite green — an untested
  // branch pretending to be covered. This case exercises it directly: a run
  // that is not finished but somehow already claims success is not a deploy,
  // whatever it claims.
  deployedByShaIndex([run(".github/workflows/deploy-selfhost.yml", "in_progress", "success")], DEPLOYS)
    ? bad("a run still in flight was accepted because it already claimed success")
    : ok("a deploy must be COMPLETED, not merely claiming success mid-flight");

  // Must not manufacture a confirmation out of nothing, in either direction.
  deployedByShaIndex([], DEPLOYS) || deployedByShaIndex(null, DEPLOYS)
    ? bad("an empty or unreadable index was read as deployed")
    : ok("an empty or unreadable commit index does not claim a deploy");

  // A repo whose deploy workflow is named differently must still match.
  deployedByShaIndex([run(".github/workflows/deploy.yml", "completed", "success")], ["deploy.yml"])
    ? ok("matches whatever the repo's deploy workflow is actually called")
    : bad("a differently-named deploy workflow was not matched");
  deployedByShaIndex([run(".github/workflows/deploy.yml", "completed", "success")], DEPLOYS)
    ? bad("matched a deploy workflow belonging to a different repo's naming")
    : ok("does not match a workflow that is not this repo's deployer");
}

console.log();
console.log(`test-deploy-freshness-audit: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
