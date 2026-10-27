#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseRepositories, reconcileRepositories } from "./reconcile-package-repo-settings.mjs";

let pass = 0;
let fail = 0;
const ok = (condition, label) => {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    fail++;
  }
};
const throws = (fn, pattern, label) => {
  try {
    fn();
    ok(false, label);
  } catch (error) {
    ok(pattern.test(error.message), label);
  }
};

console.log("package registry");
const registry = readFileSync(new URL("../../registers/packages.json", import.meta.url), "utf8");
const repos = parseRepositories(registry);
ok(repos.length > 0, "the registered package repositories are represented");
ok(repos.every((repo) => repo.startsWith("bitbaum/")), "every repo is restricted to the studio owner");
ok(new Set(repos).size === repos.length, "repositories are unique");
throws(() => parseRepositories('{"packages":[]}'), /no package repositories/, "an empty registry fails closed");
throws(() => parseRepositories('{"packages":[{"name":"x","repo":"https://github.com/other/x"}]}'), /invalid canonical/, "a repo outside Bitbaum fails closed");

console.log("settings reconciliation");
const calls = [];
let enabled = false;
let deleteBranches = false;
const fakeGh = (args) => {
  calls.push(args);
  if (args[0] === "api")
    return JSON.stringify({
      full_name: args[1].slice("repos/".length),
      allow_auto_merge: enabled,
      delete_branch_on_merge: deleteBranches,
    });
  if (args[0] === "repo" && args.includes("--enable-auto-merge") && args.includes("--delete-branch-on-merge")) {
    enabled = true;
    deleteBranches = true;
    return "";
  }
  throw new Error(`unexpected command: ${args.join(" ")}`);
};
const result = reconcileRepositories(["bitbaum/example"], fakeGh);
ok(result.changed === 1 && enabled && deleteBranches, "both package merge settings are enabled");
ok(calls.some((args) => args[0] === "repo" && args.includes("--enable-auto-merge") && args.includes("--delete-branch-on-merge")), "the GitHub CLI receives both explicit settings");
calls.length = 0;
deleteBranches = false;
const partial = reconcileRepositories(["bitbaum/example"], fakeGh);
ok(partial.changed === 1 && enabled && deleteBranches, "a partially configured repo receives the missing setting");
ok(calls.filter((args) => args[0] === "api").length === 2, "partial settings are verified after the write");
calls.length = 0;
const already = reconcileRepositories(["bitbaum/example"], fakeGh);
ok(already.changed === 0 && calls.length === 1, "an enabled repo is left untouched");
throws(() => reconcileRepositories(["bitbaum/example"], () => JSON.stringify({ allow_auto_merge: false })), /response is incomplete/, "incomplete settings responses fail closed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
