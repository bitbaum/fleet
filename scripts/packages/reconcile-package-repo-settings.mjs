#!/usr/bin/env node
/**
 * Keep GitHub's repository-level auto-merge switch on for every first-party
 * package in the Fleet registry. The workflow file alone cannot turn it on.
 *
 *   node scripts/packages/reconcile-package-repo-settings.mjs [--dry-run]
 *
 * This runs from Fleet Actions with FLEET_PAT because the GitHub App used in
 * agent sessions can inspect repositories but cannot change their settings.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORG = "bitbaum";
const DRY_RUN = process.argv.includes("--dry-run");

/** Accept only the package registry's canonical GitHub repository URLs. */
export function parseRepositories(text) {
  const registry = JSON.parse(text);
  if (!Array.isArray(registry.packages) || registry.packages.length === 0)
    throw new Error("registers/packages.json has no package repositories");
  const repos = new Set();
  for (const pkg of registry.packages) {
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/.exec(
      pkg.repo ?? "",
    );
    if (!match || match[1].toLowerCase() !== ORG)
      throw new Error(`${pkg.name ?? "package"}: invalid canonical repository URL`);
    repos.add(`${match[1]}/${match[2]}`);
  }
  return [...repos].sort();
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** Reconcile idempotently and verify every write, so permissions or drift fail visibly. */
export function reconcileRepositories(repos, run = gh) {
  let changed = 0;
  for (const repo of repos) {
    const current = JSON.parse(run(["api", `repos/${repo}`]));
    if (
      current.full_name !== repo ||
      typeof current.allow_auto_merge !== "boolean" ||
      typeof current.delete_branch_on_merge !== "boolean"
    )
      throw new Error(`${repo}: repository settings response is incomplete`);
    const missing = [];
    if (!current.allow_auto_merge) missing.push("auto-merge");
    if (!current.delete_branch_on_merge) missing.push("delete-branch-on-merge");
    if (missing.length === 0) {
      console.log(`✓ ${repo}: auto-merge and head-branch cleanup already enabled`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`→ ${repo}: would enable ${missing.join(" and ")}`);
      continue;
    }
    run([
      "repo",
      "edit",
      repo,
      "--enable-auto-merge",
      "--delete-branch-on-merge",
    ]);
    const verified = JSON.parse(run(["api", `repos/${repo}`]));
    if (
      verified.allow_auto_merge !== true ||
      verified.delete_branch_on_merge !== true
    )
      throw new Error(`${repo}: GitHub did not retain the package merge settings`);
    console.log(`✓ ${repo}: enabled and verified`);
    changed++;
  }
  return { count: repos.length, changed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repos = parseRepositories(
    readFileSync(join(ROOT, "registers", "packages.json"), "utf8"),
  );
  const result = reconcileRepositories(repos);
  console.log(`Checked ${result.count} package repositories; enabled ${result.changed}.`);
}
