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

import { deployFreshness, FRESHNESS, GRACE_MINUTES } from "./deploy-freshness-audit.mjs";

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

console.log();
console.log(`test-deploy-freshness-audit: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
