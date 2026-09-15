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
import { shouldDispatch, ciVerdict, needsCiRerun, deployedByShaIndex, ACTION, MAX_DISPATCHES, MAX_RERUNS } from "./deploy-reconciler.mjs";
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

// ── re-running CI: the repair for a tip that can never go green ─────────────
//
// loki 2026-09-15: concurrency cancelled both CI runs for the tip, so all six
// chained Deploy runs skipped and the tip could never ship — the green run the
// chain waits for could not appear, because nothing re-runs a cancelled CI.
// Declining to deploy that is right; declining AND doing nothing leaves the
// repo exactly as stuck as it was found.
{
  needsCiRerun({ state: FRESHNESS.STALE, ci: "none", ciInFlight: false }).rerun
    ? ok("a stale tip with no green CI run gets its CI re-run — the repair is not inert")
    : bad("the one case this exists for did not trigger a re-run");

  // A red build is not repaired by running it again, and a reconciler that
  // retries red CI every half hour forever is a CI amplifier, not a fix.
  needsCiRerun({ state: FRESHNESS.STALE, ci: "red", ciInFlight: false }).rerun
    ? bad("a RED tip was re-run — that loops on a genuinely broken build")
    : ok("a RED tip is not re-run; it is broken, not unverified");

  needsCiRerun({ state: FRESHNESS.STALE, ci: "green", ciInFlight: false }).rerun
    ? bad("a green tip was re-run for no reason")
    : ok("a green tip is not re-run — it needs a deploy, not another CI");

  needsCiRerun({ state: FRESHNESS.STALE, ci: "none", ciInFlight: true }).rerun
    ? bad("CI was re-run while a run was already in flight")
    : ok("no re-run while a CI run is already in flight");

  needsCiRerun({ state: FRESHNESS.DEPLOYED, ci: "none", ciInFlight: false }).rerun
    ? bad("a deployed repo had its CI re-run")
    : ok("a repo that is already live is left alone");
  needsCiRerun({ state: FRESHNESS.PENDING, ci: "none", ciInFlight: false }).rerun
    ? bad("a repo inside the reconciler window had its CI re-run")
    : ok("a repo inside the window is left alone");

  MAX_RERUNS > 0 && MAX_RERUNS <= MAX_DISPATCHES
    ? ok(`the re-run cap (${MAX_RERUNS}) is set and no looser than the deploy cap`)
    : bad(`the re-run cap ${MAX_RERUNS} is not a bound`);
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
console.log(`test-deploy-reconciler: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
