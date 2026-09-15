#!/usr/bin/env node
/**
 * The reconciler holds a deploy button for every repo in the org, so the two
 * decisions that can press it — "is this tip green?" and "should I ship it?" —
 * are pure, and both directions of each are pinned here.
 *
 * Pinning both directions is the point. A guard that only ever says "no" is
 * indistinguishable from a broken reconciler, and a guard that only ever says
 * "yes" is a fleet-wide outage waiting for one bad predicate.
 */
import { shouldDispatch, ciVerdict, ACTION, MAX_DISPATCHES } from "./deploy-reconciler.mjs";
import { FRESHNESS } from "./deploy-freshness-audit.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const is = (actual, expected, m) => (actual === expected ? ok(m) : bad(`${m} — got ${actual}, wanted ${expected}`));

const run = (status, conclusion) => ({ status, conclusion });

// ── ciVerdict ───────────────────────────────────────────────────────────────

is(ciVerdict([run("completed", "success")]), "green", "an all-success tip is green");
is(ciVerdict([run("completed", "success"), run("completed", "skipped")]), "green",
   "skipped checks do not spoil a green tip");
is(ciVerdict([run("completed", "success"), run("completed", "failure")]), "red",
   "one failure makes the tip red even beside successes");
is(ciVerdict([run("completed", "timed_out")]), "red", "a timed-out check is red, not merely absent");
is(ciVerdict([run("completed", "success"), run("in_progress", null)]), "pending",
   "a check still running makes the tip pending — never ship over a live CI");

// The one that matters most here. loki 2026-09-15: concurrency cancelled BOTH
// CI runs for the tip, so nothing green ever existed for the chained deploy to
// fire on. Reading `cancelled` as a pass would have shipped an unverified tip.
is(ciVerdict([run("completed", "cancelled"), run("completed", "cancelled")]), "none",
   "a tip whose every CI run was CANCELLED is not green — it is unverified");
is(ciVerdict([]), "none", "no checks at all is 'none', not 'green'");
is(ciVerdict(null), "none", "an unreadable check list is 'none' — it must never ship");

// ── shouldDispatch ──────────────────────────────────────────────────────────

is(shouldDispatch({ state: FRESHNESS.STALE, ci: "green", deployInFlight: false }).action, ACTION.DISPATCH,
   "a stale, green, idle repo IS shipped — the tool is not inert");

is(shouldDispatch({ state: FRESHNESS.DEPLOYED, ci: "green", deployInFlight: false }).action, ACTION.SKIP,
   "an already-deployed tip is left alone");
is(shouldDispatch({ state: FRESHNESS.PENDING, ci: "green", deployInFlight: false }).action, ACTION.SKIP,
   "a tip inside the reconciler window is left alone");
is(shouldDispatch({ state: FRESHNESS.UNKNOWN, ci: "green", deployInFlight: false }).action, ACTION.SKIP,
   "an unjudgeable repo is never shipped on a guess");

is(shouldDispatch({ state: FRESHNESS.STALE, ci: "red", deployInFlight: false }).action, ACTION.SKIP,
   "a RED tip is never shipped, however stale");
is(shouldDispatch({ state: FRESHNESS.STALE, ci: "pending", deployInFlight: false }).action, ACTION.SKIP,
   "a tip whose CI is still running is not shipped — the chained deploy may still fire");
is(shouldDispatch({ state: FRESHNESS.STALE, ci: "none", deployInFlight: false }).action, ACTION.SKIP,
   "a stale tip with no green CI run is REPORTED, not shipped");
is(shouldDispatch({ state: FRESHNESS.STALE, ci: "green", deployInFlight: true }).action, ACTION.SKIP,
   "no second deploy while one is in flight");

// The stuck-without-green case must say what is actually wrong, because the
// remedy is a CI re-run and a reader who is told only "skipped" will go looking
// at the deploy.
{
  const r = shouldDispatch({ state: FRESHNESS.STALE, ci: "none", deployInFlight: false });
  /CI re-run/.test(r.reason)
    ? ok("a stale tip with no green CI names the real remedy: re-run CI, not deploy")
    : bad(`unhelpful reason: ${r.reason}`);
}

// ── the cap ─────────────────────────────────────────────────────────────────
MAX_DISPATCHES > 0 && MAX_DISPATCHES < 21
  ? ok(`the dispatch cap (${MAX_DISPATCHES}) is smaller than the fleet — a bad predicate cannot ship everything`)
  : bad(`the cap ${MAX_DISPATCHES} does not bound a fleet-wide mistake`);

console.log();
console.log(`test-deploy-reconciler: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
