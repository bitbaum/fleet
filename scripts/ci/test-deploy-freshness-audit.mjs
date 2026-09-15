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

import { deployFreshness, isDeployerSource, FRESHNESS, GRACE_MINUTES } from "./deploy-freshness-audit.mjs";

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

console.log();
console.log(`test-deploy-freshness-audit: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
