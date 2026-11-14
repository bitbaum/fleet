import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUMP_SUBJECT = "chore(deps): raise shared package floors to published versions";

/**
 * A merge of the default branch into the bump branch, as GitHub's "Update
 * branch" button and `git merge main` write it. It carries nothing a fresh
 * branch cut from main does not already have, so it is not a repair.
 *
 * Why: evig#682 got one such merge on 2026-11-10, main then moved on, the
 * pull request went into conflict, and every later run "preserved" that
 * merge as if it were a person's fix. Evig stayed on ai-kit 1.26 and
 * accountkit 0.27 while every other app moved. A merge of any OTHER branch,
 * or a merge commit with any other subject, still counts as a repair.
 */
export function isDefaultBranchMerge(entry) {
  const subject = entry?.commit?.message?.split("\n")[0] ?? "";
  return (
    Array.isArray(entry?.parents) &&
    entry.parents.length === 2 &&
    /^Merge (remote-tracking )?branch '(origin\/)?(main|master)'( of \S+)?( into \S+)?$/.test(subject)
  );
}

export function mayReplaceCurrencyBranch(commits) {
  return (
    Array.isArray(commits) &&
    commits.some((entry) => entry?.commit?.message?.split("\n")[0] === BUMP_SUBJECT) &&
    commits.every(
      (entry) =>
        entry?.commit?.message?.split("\n")[0] === BUMP_SUBJECT || isDefaultBranchMerge(entry),
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = mayReplaceCurrencyBranch(
    JSON.parse(readFileSync(0, "utf8")),
  )
    ? 0
    : 1;
}
