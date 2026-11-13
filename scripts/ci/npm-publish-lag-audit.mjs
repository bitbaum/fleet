#!/usr/bin/env node
/**
 * Is every package's released version actually on npm?
 *
 * WHY THIS EXISTS
 *
 * A package releases itself: a merged version bump tags the commit (the
 * verified Git release) and runs `publish.yml`, which uploads to npm through
 * npm Trusted Publishing. When npm does not trust the workflow, the upload
 * fails with ENEEDAUTH — and the only trace is a red run in the package's own
 * Actions tab, which nobody reads. Measured 2026-11-13: @bitbaum/bip-kit 0.7.0
 * and 0.7.1 were tagged on GitHub while npm still served 0.6.1, for three
 * days. Consumers that installed from Git then failed on a build-environment
 * difference, and the rollout gate held their pull requests: one missing npm
 * setting stalled a feature in two products.
 *
 * WHAT IT ASKS
 *
 * Per registered npm package: is the version on the repo's main branch
 * published? A version newer than npm's `latest` is a finding once it has had
 * GRACE_MINUTES to publish. The finding names the one fix that is a human's —
 * npm's Trusted Publisher form, which needs the account's own 2FA — with the
 * exact link and values, and the link to re-run the publish afterwards.
 *
 *   node scripts/ci/npm-publish-lag-audit.mjs            # report
 *   node scripts/ci/npm-publish-lag-audit.mjs --check    # exit 1 on a finding
 *   node scripts/ci/npm-publish-lag-audit.mjs --issue    # open/update/close the fleet issue
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GRACE_MINUTES = 120;
export const ISSUE_TITLE = "npm releases behind GitHub";
const ISSUE_REPO = "bitbaum/fleet";

/** -1, 0 or 1. Pre-release suffixes sort before the release they precede. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ""] = String(v).split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) < (y.nums[i] ?? 0) ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * The judgement, pure. `releasedAt` is when main's version was committed (or
 * tagged); a younger release is pending, not lagging.
 */
export function publishLag({ name, mainVersion, npmVersion, releasedAt, now }) {
  if (!mainVersion) return { state: "unknown", reason: "main has no version" };
  if (npmVersion && compareVersions(mainVersion, npmVersion) <= 0) return { state: "published" };
  const ageMinutes = releasedAt ? (Date.parse(now) - Date.parse(releasedAt)) / 60000 : Infinity;
  if (ageMinutes < GRACE_MINUTES) return { state: "pending" };
  return {
    state: "lagging",
    reason: npmVersion
      ? `main is ${mainVersion}, npm serves ${npmVersion}`
      : `main is ${mainVersion}, ${name} is not on npm`,
  };
}

/** What the owner does, in order, with every value spelled out. */
export function fixSteps({ name, repo }) {
  const slug = repo.replace(/^https:\/\/github\.com\//, "");
  return [
    `1. Open https://www.npmjs.com/package/${name}/access and sign in.`,
    `2. Under "Trusted Publisher" choose GitHub Actions and enter: organization \`${slug.split("/")[0]}\`, repository \`${slug.split("/")[1]}\`, workflow \`publish.yml\`, environment empty. Save (npm asks for your 2FA code).`,
    `3. Re-run the release: https://github.com/${slug}/actions/workflows/publish.yml → "Run workflow" on \`main\`.`,
  ].join("\n");
}

export function issueBody(findings, now) {
  const lines = [
    `Checked ${now}. These packages are released on GitHub but not on npm, so apps that take them from npm cannot update, and apps that install from Git hit build-environment differences and the rollout gate.`,
    "",
  ];
  for (const f of findings) {
    lines.push(`### ${f.name} — ${f.reason}`, "", fixSteps(f), "");
  }
  lines.push(
    "This issue is written by `scripts/ci/npm-publish-lag-audit.mjs` (daily, `.github/workflows/npm-publish-lag.yml`) and closes itself when every package is published.",
  );
  return lines.join("\n");
}

// ── I/O ──────────────────────────────────────────────────────────────────────

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The repos are public: read them over HTTPS, with a token when CI has one (rate limit). */
async function github(path) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${path}`);
  return response.json();
}

async function mainManifest(slug) {
  const response = await fetch(`https://raw.githubusercontent.com/${slug}/main/package.json`);
  if (!response.ok) throw new Error(`raw.githubusercontent.com returned HTTP ${response.status} for ${slug}`);
  const manifest = await response.json();
  // When the version was committed decides "still publishing" vs "lagging".
  // Unknown (no API access) counts as old: a real lag must never hide.
  const commits = await github(`repos/${slug}/commits?path=package.json&per_page=1`).catch(() => []);
  return { version: manifest.version, releasedAt: commits[0]?.commit?.committer?.date ?? null };
}

async function npmLatest(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status} for ${name}`);
  return (await response.json())["dist-tags"]?.latest ?? null;
}

async function syncIssue(findings, now) {
  const open = JSON.parse(
    gh(["api", `repos/${ISSUE_REPO}/issues?state=open&per_page=100`]),
  ).find((i) => i.title === ISSUE_TITLE);
  if (findings.length === 0) {
    if (open) {
      gh(["api", "-X", "PATCH", `repos/${ISSUE_REPO}/issues/${open.number}`, "-f", "state=closed"]);
      console.log(`closed #${open.number}: every package is published`);
    }
    return;
  }
  const body = issueBody(findings, now);
  if (open) {
    gh(["api", "-X", "PATCH", `repos/${ISSUE_REPO}/issues/${open.number}`, "-f", `body=${body}`]);
    console.log(`updated #${open.number}`);
  } else {
    const created = JSON.parse(
      gh(["api", `repos/${ISSUE_REPO}/issues`, "-f", `title=${ISSUE_TITLE}`, "-f", `body=${body}`]),
    );
    console.log(`opened #${created.number}`);
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const register = JSON.parse(readFileSync(join(here, "../../registers/packages.json"), "utf8"));
  const now = new Date().toISOString();
  const findings = [];
  for (const pkg of register.packages.filter((p) => p.install?.source === "npm")) {
    const slug = pkg.repo.replace(/^https:\/\/github\.com\//, "");
    const [{ version, releasedAt }, npmVersion] = await Promise.all([mainManifest(slug), npmLatest(pkg.name)]);
    const verdict = publishLag({ name: pkg.name, mainVersion: version, npmVersion, releasedAt, now });
    console.log(`${verdict.state.padEnd(9)} ${pkg.name}  main ${version}  npm ${npmVersion ?? "—"}`);
    if (verdict.state === "lagging") findings.push({ name: pkg.name, repo: pkg.repo, reason: verdict.reason });
  }
  if (findings.length) console.log(`\n${issueBody(findings, now)}`);
  if (process.argv.includes("--issue")) await syncIssue(findings, now);
  if (process.argv.includes("--check") && findings.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
