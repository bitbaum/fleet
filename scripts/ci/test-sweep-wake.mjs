#!/usr/bin/env node
/**
 * The wake script holds a dispatch button for every repo in the org, so the one
 * decision that presses it is pure and pinned in both directions: it must wake a
 * repo that has work waiting, and it must leave alone everything that does not.
 */
import { chooseWakeTargets, touchesDependencies, MAX_WAKES } from "./sweep-wake.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const is = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));

const repo = (name, openPrs, sweepActive = false) => ({ name, branch: "main", openPrs, sweepActive });
const names = (r) => r.wake.map((w) => w.repo);

is(names(chooseWakeTargets({ owner: "o", repos: [repo("a", 2)] })), ["o/a"], "a repo with an open PR is woken");
is(names(chooseWakeTargets({ owner: "o", repos: [repo("a", 0)] })), [], "a repo with nothing open is left alone");
is(names(chooseWakeTargets({ owner: "o", repos: [repo("a", 3, true)] })), [], "a sweep already queued or running is not doubled");
is(names(chooseWakeTargets({ owner: "o", repos: [repo("a", 1), repo("b", 1)], skip: new Set(["o/b"]) })), ["o/a"], "WAKE_SKIP is honoured");
is(chooseWakeTargets({ owner: "o", repos: [repo("a", 1)] }).wake[0].branch, "main", "the dispatch goes to the repo's own default branch");

const many = Array.from({ length: MAX_WAKES + 1 }, (_, i) => repo(`r${i}`, 1));
const capped = chooseWakeTargets({ owner: "o", repos: many });
is(capped.wake.length, 0, "past the cap it wakes nothing");
is(capped.overCap, MAX_WAKES + 1, "and says how far over it was");
is(names(chooseWakeTargets({ owner: "o", repos: many.slice(0, MAX_WAKES) })).length, MAX_WAKES, "exactly at the cap still works");

is(touchesDependencies(["src/a.ts", "pnpm-lock.yaml"]), true, "a lockfile change can be held by the rollout gate");
is(touchesDependencies(["apps/web/package.json"]), true, "a nested manifest change can be held too");
is(touchesDependencies(["src/package.json.ts", "README.md"]), false, "a source file that merely resembles a manifest cannot");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
