/**
 * Every workflow run GitHub holds for one commit, newest first.
 *
 * `actions/runs?head_sha=` answers 100 runs a page at most. Reading only the
 * first page answered "did CI pass on this commit?" with whatever the newest
 * hundred runs happened to be. A tip that stays the tip collects a sweep or
 * reconcile dispatch every quarter hour, all keyed to the same commit, so
 * after about a day its own CI and browser runs fall to page two and the
 * commit reads as never having passed. Measured 2026-11-12 on kivvi: 129 runs
 * on e64eaec, the green ci.yml and browser-smoke.yml at positions 124 and
 * 125, and the package rollout gate holding every limitkit consumer behind
 * "wait for bitbaum/kivvi to deploy this artifact and pass CI/browser checks"
 * on a canary that had done both.
 *
 * Pages keep GitHub's newest-first order, so a caller that takes the first
 * run per workflow still takes the newest. A run created while the pages are
 * read pushes the rest down by one: the next page repeats a run already seen,
 * which a first-per-workflow reader ignores, and skips none.
 */
export const RUNS_PAGE_SIZE = 100;

/** The API path of one page of a commit's runs. */
export function runsForShaPath(repo, sha, page) {
  return `repos/${repo}/actions/runs?head_sha=${sha}&per_page=${RUNS_PAGE_SIZE}&page=${page}`;
}

/**
 * `readPage(page)` returns the API's answer for that page. More than
 * `maxPages` pages is an error, never a silent cut: evidence that stops at a
 * limit is the defect this module exists to remove.
 */
export function everyRunForSha(readPage, { maxPages = 10 } = {}) {
  const runs = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = readPage(page);
    const batch = body?.workflow_runs;
    if (!Array.isArray(batch)) throw new Error("workflow runs are unavailable");
    runs.push(...batch);
    const total = Number(body.total_count);
    if (batch.length < RUNS_PAGE_SIZE || (Number.isFinite(total) && runs.length >= total))
      return runs;
  }
  throw new Error(
    `more than ${maxPages * RUNS_PAGE_SIZE} workflow runs on one commit; the evidence would be incomplete`,
  );
}
