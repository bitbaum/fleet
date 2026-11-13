#!/usr/bin/env node
/**
 * Self-test for npm-publish-lag-audit.mjs. No network, no gh.
 *
 * The negative cases matter as much as the positive: a release minutes old is
 * still publishing, and an audit that reported it would cry wolf on every
 * merge until it was muted.
 */

import { compareVersions, publishLag, fixSteps, issueBody, GRACE_MINUTES } from "./npm-publish-lag-audit.mjs";

let pass = 0, fail = 0;
const eq = (got, want, m) => {
  if (got === want) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const NOW = "2026-11-13T12:00:00Z";
const old = "2026-11-10T12:00:00Z";
const fresh = new Date(Date.parse(NOW) - (GRACE_MINUTES - 5) * 60000).toISOString();

console.log("test-npm-publish-lag-audit");

eq(compareVersions("0.7.1", "0.6.1"), 1, "0.7.1 is newer than 0.6.1");
eq(compareVersions("0.10.0", "0.9.9"), 1, "numeric, not lexical");
eq(compareVersions("1.0.0", "1.0.0"), 0, "equal");
eq(compareVersions("1.0.0-rc.1", "1.0.0"), -1, "a pre-release precedes its release");

const pkg = { name: "@bitbaum/bip-kit" };
eq(publishLag({ ...pkg, mainVersion: "0.7.1", npmVersion: "0.6.1", releasedAt: old, now: NOW }).state, "lagging",
  "the measured case: tagged three days ago, npm two versions behind");
eq(publishLag({ ...pkg, mainVersion: "0.7.1", npmVersion: "0.7.1", releasedAt: old, now: NOW }).state, "published",
  "same version is published");
eq(publishLag({ ...pkg, mainVersion: "0.7.0", npmVersion: "0.7.1", releasedAt: old, now: NOW }).state, "published",
  "npm ahead of main (a hotfix published from a tag) is not a lag");
eq(publishLag({ ...pkg, mainVersion: "0.7.1", npmVersion: "0.6.1", releasedAt: fresh, now: NOW }).state, "pending",
  "inside the grace window it is still publishing");
eq(publishLag({ ...pkg, mainVersion: "0.1.0", npmVersion: null, releasedAt: old, now: NOW }).reason,
  "main is 0.1.0, @bitbaum/bip-kit is not on npm", "never published names the package");
eq(publishLag({ ...pkg, mainVersion: undefined, npmVersion: "1.0.0", releasedAt: old, now: NOW }).state, "unknown",
  "no version on main is not a finding");

const steps = fixSteps({ name: "@bitbaum/bip-kit", repo: "https://github.com/bitbaum/bip-kit" });
eq(steps.includes("https://www.npmjs.com/package/@bitbaum/bip-kit/access"), true, "links npm's settings page");
eq(steps.includes("repository `bip-kit`") && steps.includes("workflow `publish.yml`"), true, "spells out every value");
eq(steps.includes("https://github.com/bitbaum/bip-kit/actions/workflows/publish.yml"), true, "links the re-run");
eq(issueBody([{ name: "@bitbaum/bip-kit", repo: "https://github.com/bitbaum/bip-kit", reason: "r" }], NOW)
  .includes("### @bitbaum/bip-kit — r"), true, "the issue has one section per package");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
