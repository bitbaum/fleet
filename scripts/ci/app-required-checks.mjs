import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CHECKS = ["verify", "account / lifecycle"];
export const REPO_CHECKS = {
  causius: CHECKS,
  heidi: CHECKS,
  fleet: ["verify", "app-template"],
};
const ACTIONS_APP = 15368;
export function assertGreen(checks, sha, required = CHECKS) {
  for (const name of required) {
    const latest = checks
      .filter(
        (c) =>
          c.name === name && c.app?.id === ACTIONS_APP && c.head_sha === sha,
      )
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== "completed" || latest.conclusion !== "success")
      throw new Error(`Required main check is not green: ${name}`);
  }
}
export function policyFor(previous = null, required = CHECKS) {
  const checks = new Map();
  for (const check of previous?.required_status_checks?.checks ?? [])
    checks.set(check.context, check);
  for (const context of previous?.required_status_checks?.contexts ?? [])
    if (!checks.has(context)) checks.set(context, { context });
  for (const context of required)
    checks.set(context, { context, app_id: ACTIONS_APP });
  // Preserve stronger review, signature and push restrictions already present.
  return {
    required_status_checks: {
      strict: true,
      checks: [...checks.values()].map((c) =>
        c.app_id
          ? { context: c.context, app_id: c.app_id }
          : { context: c.context },
      ),
    },
    enforce_admins: true,
    required_pull_request_reviews:
      previous?.required_pull_request_reviews ?? null,
    restrictions: previous?.restrictions
      ? {
          users: previous.restrictions.users.map((u) => u.login),
          teams: previous.restrictions.teams.map((t) => t.slug),
          apps: previous.restrictions.apps.map((a) => a.slug),
        }
      : null,
    required_linear_history:
      previous?.required_linear_history?.enabled ?? false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: previous?.block_creations?.enabled ?? false,
    required_conversation_resolution:
      previous?.required_conversation_resolution?.enabled ?? false,
    lock_branch: previous?.lock_branch?.enabled ?? false,
    allow_fork_syncing: previous?.allow_fork_syncing?.enabled ?? false,
  };
}
async function main() {
  const mode = process.argv[2] ?? "inspect";
  if (!["inspect", "apply"].includes(mode))
    throw new Error("Unknown policy action");
  const api = (path, method = "GET", data) =>
    JSON.parse(
      execFileSync(
        "gh",
        ["api", "--method", method, path, ...(data ? ["--input", "-"] : [])],
        {
          encoding: "utf8",
          input: data ? JSON.stringify(data) : undefined,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ),
    );
  for (const [name, required] of Object.entries(REPO_CHECKS)) {
    const repo = `bitbaum/${name}`,
      info = api(`repos/${repo}`),
      branch = info.default_branch;
    if (!info.permissions?.admin)
      throw new Error(`${repo}: maintenance administration unavailable`);
    // Applied branch rules include inherited organization rulesets.
    const rules = api(
      `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`,
    );
    if (rules.length)
      throw new Error(
        `${repo}: existing ruleset requires reconciliation before this policy change`,
      );
    let previous = null;
    try {
      previous = api(
        `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
      );
    } catch (error) {
      if (!String(error.stderr).includes("(HTTP 404)"))
        throw new Error(`${repo}: protection inspection failed`);
    }
    const commit = api(
      `repos/${repo}/commits/${encodeURIComponent(branch)}`,
    ).sha;
    const checks = api(
      `repos/${repo}/commits/${commit}/check-runs?per_page=100`,
    ).check_runs;
    assertGreen(checks, commit, required);
    const payload = policyFor(previous, required);
    if (mode === "apply") {
      if (
        api(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !==
        commit
      )
        throw new Error(`${repo}: main changed; inspect again`);
      api(
        `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
        "PUT",
        payload,
      );
      const actual = api(
        `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
      );
      if (
        !actual.enforce_admins?.enabled ||
        !actual.required_status_checks?.strict
      )
        throw new Error(`${repo}: protection readback failed`);
      for (const context of required)
        if (
          !actual.required_status_checks.checks.some(
            (c) => c.context === context && c.app_id === ACTIONS_APP,
          )
        )
          throw new Error(`${repo}: required check readback failed`);
    }
    console.log(
      JSON.stringify({
        repo,
        mode,
        commit,
        required,
        strict: true,
        enforceAdmins: true,
        applied: mode === "apply",
      }),
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      /^(bitbaum\/(causius|heidi|fleet):|Required main check|Unknown policy)/.test(
        error.message,
      )
        ? error.message
        : "Required-check policy API request failed; no credentials or API bodies logged.",
    );
    process.exitCode = 1;
  });
