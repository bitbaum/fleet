import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export const CONFIG = {
  site: {
    repo: "bitbaum/bitbaum",
    branch: "fleet/generated-site-snapshots",
    paths: [
      "site/origin.snapshot.json",
      "site/readings.snapshot.json",
      "site/map.snapshot.json",
      "site/packages.snapshot.json",
      "site/package-records.snapshot.json",
      "site/live.snapshot.json",
      "site/dist",
      "docs/CAST.md",
    ],
    title: "chore(site): refresh published source snapshots",
  },
  registry: {
    branch: "fleet/generated-package-registry",
    paths: ["registers/packages.json"],
    title: "chore(registers): refresh derived package registry",
  },
  readings: {
    branch: "fleet/generated-readings",
    paths: ["registers/readings.json"],
    title: "chore(registers): refresh readings",
  },
  origin: {
    branch: "fleet/generated-origin-proof",
    paths: ["proofs/origin", "registers/origin.json"],
    title: "chore(registers): refresh origin proofs",
  },
};
export function assertOwnedPaths(paths, config) {
  if (
    paths.some(
      (p) =>
        !config.paths.some(
          (allowed) => p === allowed || p.startsWith(allowed + "/"),
        ),
    )
  )
    throw new Error(
      "Generated branch contains changes outside its owned paths",
    );
}
let step = "validate";
function main() {
  const config = CONFIG[process.argv[2]];
  if (!config) throw new Error("Unknown generated update");
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== (config.repo ?? "bitbaum/fleet") ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw new Error(
      "Generated PR writer requires its configured repository main checkout",
    );
  if (!process.env.GH_TOKEN) throw new Error("Maintenance token is required");
  const run = (cmd, args) => {
    step = [cmd, ...args.slice(0, 2)].join(" ");
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  };
  const git = (...args) => run("git", args),
    gh = (...args) => run("gh", args);
  assertOwnedPaths(
    git("diff", "--cached", "--name-only").split("\n").filter(Boolean),
    config,
  );
  git("add", "-A", "--", ...config.paths);
  const diff = spawnSync("git", ["diff", "--cached", "--quiet"], {
    stdio: "pipe",
  });
  if (diff.status === 0) {
    console.log("No generated changes to propose");
    return;
  }
  if (diff.status !== 1) throw new Error("Generated diff failed");
  assertOwnedPaths(
    git("diff", "--cached", "--name-only").split("\n").filter(Boolean),
    config,
  );
  const repo = config.repo ?? "bitbaum/fleet",
    branch = config.branch;
  const prs = JSON.parse(
    gh(
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
    ),
  );
  const remote = git("ls-remote", "origin", `refs/heads/${branch}`).split(
    /\s/,
  )[0];
  if (remote) {
    const changed = prs.length
      ? gh("pr", "diff", String(prs[0].number), "--repo", repo, "--name-only")
      : gh(
          "api",
          `repos/${repo}/compare/main...${branch}`,
          "--jq",
          ".files[].filename",
        );
    assertOwnedPaths(changed.split("\n").filter(Boolean), config);
  }
  git("config", "user.name", "fleet-bot");
  git("config", "user.email", "noreply@bitbaum.invalid");
  git("commit", "-m", config.title);
  // Same explicit feature-branch lease as internal-currency.yml. Authenticate
  // through gh so an existing PR head update also triggers its exact-head CI.
  gh("auth", "setup-git", "--hostname", "github.com");
  git(
    "push",
    `--force-with-lease=refs/heads/${branch}:${remote}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  );
  if (prs.length) {
    console.log(`Updated generated PR #${prs[0].number}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fleet-generated-pr-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(
      file,
      "Refresh generated facts from their canonical producers.\n\nThe generator ran in this workflow. Exact-head CI, documentation and rollout policy checks must pass through the normal Fleet merge sweep. Only the declared generated paths are included.\n",
      { mode: 0o600 },
    );
    gh(
      "pr",
      "create",
      "--repo",
      repo,
      "--head",
      branch,
      "--base",
      "main",
      "--title",
      config.title,
      "--body-file",
      file,
    );
    console.log("Created generated PR; normal merge gates remain required");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      /^(Generated|Unknown|Maintenance)/.test(error.message)
        ? error.message
        : "Generated PR operation failed without exposing credentials.",
    );
    console.error(
      JSON.stringify({
        step,
        status: Number.isInteger(error.status) ? error.status : null,
      }),
    );
    process.exitCode = 1;
  }
}
