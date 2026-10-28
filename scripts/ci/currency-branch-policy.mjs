import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function mayReplaceCurrencyBranch(commits) {
  return (
    Array.isArray(commits) &&
    commits.length > 0 &&
    commits.every(
      (entry) =>
        entry?.commit?.message?.split("\n")[0] ===
        "chore(deps): raise shared package floors to published versions",
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
