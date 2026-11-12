import { test } from "node:test";
import assert from "node:assert/strict";
import { everyRunForSha, runsForShaPath, RUNS_PAGE_SIZE } from "./runs-for-sha.mjs";
import { successfulConsumerChecks } from "./package-rollout-gate.mjs";

const sha = "e64eaec69fd013e078e4a6c114e2507cb1508e53";
const run = (file, event, conclusion, n) => ({
  id: n,
  head_sha: sha,
  path: `.github/workflows/${file}`,
  event,
  status: "completed",
  conclusion,
});
/** The API's pages over a newest-first list of runs. */
const pages = (runs) => {
  const reads = [];
  const readPage = (page) => {
    reads.push(page);
    const start = (page - 1) * RUNS_PAGE_SIZE;
    return { total_count: runs.length, workflow_runs: runs.slice(start, start + RUNS_PAGE_SIZE) };
  };
  return { readPage, reads };
};

/** kivvi on 2026-11-12: 127 sweep dispatches newer than the commit's own CI. */
const buried = [
  ...Array.from({ length: 127 }, (_, i) => run("auto-merge.yml", "workflow_dispatch", "success", 1000 - i)),
  run("ci.yml", "push", "success", 2),
  run("browser-smoke.yml", "push", "success", 1),
];

test("reads past the first hundred runs, keeping the newest first", () => {
  const { readPage, reads } = pages(buried);
  const runs = everyRunForSha(readPage);
  assert.equal(runs.length, 129);
  assert.deepEqual(reads, [1, 2]);
  assert.deepEqual(runs.map((r) => r.id), buried.map((r) => r.id));
});

test("a commit's green CI counts when sweeps have buried it under a hundred newer runs", () => {
  const firstPageOnly = buried.slice(0, RUNS_PAGE_SIZE);
  const before = successfulConsumerChecks(firstPageOnly, [], sha, () => []);
  assert.ok(!before.includes("ci.yml") && !before.includes("browser-smoke.yml"));
  const after = successfulConsumerChecks(everyRunForSha(pages(buried).readPage), [], sha, () => []);
  assert.ok(after.includes("ci.yml"));
  assert.ok(after.includes("browser-smoke.yml"));
});

test("one page when it holds everything; no page when the commit has none", () => {
  const few = pages(buried.slice(0, 3));
  assert.equal(everyRunForSha(few.readPage).length, 3);
  assert.deepEqual(few.reads, [1]);
  const exact = pages(buried.slice(0, RUNS_PAGE_SIZE));
  assert.equal(everyRunForSha(exact.readPage).length, RUNS_PAGE_SIZE);
  assert.deepEqual(exact.reads, [1]);
  assert.deepEqual(everyRunForSha(pages([]).readPage), []);
});

test("a run created while pages are read repeats one, and a newer failure still wins", () => {
  // A new failing ci.yml run lands between page 1 and page 2: everything shifts down by one.
  const shifted = [run("ci.yml", "push", "failure", 5000), ...buried];
  let page1 = true;
  const readPage = (page) => {
    const list = page1 ? buried : shifted;
    page1 = false;
    const start = (page - 1) * RUNS_PAGE_SIZE;
    return { total_count: list.length, workflow_runs: list.slice(start, start + RUNS_PAGE_SIZE) };
  };
  const runs = everyRunForSha(readPage);
  assert.ok(runs.length >= buried.length);
  assert.ok(successfulConsumerChecks(runs, [], sha, () => []).includes("ci.yml"));
  // Read whole, the newest ci.yml run is the failure and decides.
  assert.ok(!successfulConsumerChecks(everyRunForSha(pages(shifted).readPage), [], sha, () => []).includes("ci.yml"));
});

test("refuses to answer from a cut list or an unreadable page", () => {
  const many = Array.from({ length: 1001 }, (_, i) => run("auto-merge.yml", "workflow_dispatch", "success", i));
  assert.throws(() => everyRunForSha(pages(many).readPage), /more than 1000 workflow runs/);
  assert.throws(() => everyRunForSha(() => ({ message: "Not Found" })), /unavailable/);
});

test("names each page in the API path", () => {
  assert.equal(
    runsForShaPath("bitbaum/kivvi", sha, 2),
    `repos/bitbaum/kivvi/actions/runs?head_sha=${sha}&per_page=100&page=2`,
  );
});
