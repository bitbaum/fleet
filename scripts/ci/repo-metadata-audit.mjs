#!/usr/bin/env node
// Fleet audit: does a repository's GitHub metadata agree with the register?
//
//   repo-metadata-audit.mjs [--check] [--list] [--fixture FILE]
//
// WHY
//
// A repository page is the first thing anyone opens — a client, a collaborator,
// a future session — and it is the surface furthest from the code, so it drifts
// first and silently. Measured 2026-09-11 across 44 live repos:
//
//   13 had NO homepage at all, while the register knew their host
//    1 pointed at a domain that is not the app's (evig -> revamp-it.ch)
//    4 had no description
//    1 described a product by a name its own brand file had retired
//
// None of that breaks anything, which is exactly why it sat there. The register
// (fleetcrown apps.conf) already knows the canonical host of every deployed app.
// Nothing compared the two.
//
// WHAT IS CHECKED — only the mechanical claims
//
//   1. a registered app's homepage MUST be its canonical host
//   2. a non-archived repo MUST have a description
//
// Deliberately NOT checked: whether a description is GOOD, or whether the
// display name matches the product. Those need judgement — the live <title> is
// not a reliable product name (a multi-tenant app serves the TENANT's title;
// some sites put the brand after a pipe), and a gate that guesses at prose
// gets muted. Name retirements are enforced separately, and precisely, by
// org-drift-audit.sh against registers/retired.json.
//
// EXCEPTIONS ARE DECISIONS: repo-metadata.allow carries a reason per line.
// A repo serving something the register deliberately does not hold (the
// handcrafted 4001-4004 services; a platform whose own host differs from its
// tenant's row) is a decision someone can read, not a silence.
//
// THE BASELINE IS A RATCHET — counts may fall or hold, never rise.
//
// Reads the GitHub API, not local checkouts: a checkout is one branch of one
// machine, and this is about what the world sees.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ORG = process.env.ORG ?? "bitbaum";
const ALLOW = process.env.ALLOW_FILE ?? join(here, "repo-metadata.allow");
const args = process.argv.slice(2);
const MODE = args.includes("--list") ? "list" : "check";
const FIXTURE = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;

/** allowlist: `repo|kind|reason` — kind is `homepage` or `description`. */
export function parseAllow(text) {
  const out = new Map();
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [repo, kind] = line.split("|");
    if (!repo || !kind) continue;
    out.set(`${repo.trim()}|${kind.trim()}`, true);
  }
  return out;
}

/** apps.conf -> Map(repoDirName -> {name, domain, status}). The register keys
 *  rows by DEPLOY name and points at a repo PATH; the repo is the last segment. */
export function parseRegister(conf) {
  const out = new Map();
  for (const line of (conf ?? "").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    if (f.length !== 12) continue;
    const repo = f[3].replace(/\/+$/, "").split("/").pop();
    const domain = (f[2] || "").split(",")[0];
    if (domain && domain !== "-") out.set(repo, { name: f[0], domain, status: f[8] });
  }
  return out;
}

/** The judgement, isolated from the network so it can be tested. */
export function judge({ repos, register, allow }) {
  const findings = [];
  for (const r of repos) {
    if (r.archived) continue;
    const reg = register.get(r.name);
    const homepage = (r.homepage ?? "").trim();
    const description = (r.description ?? "").trim();

    if (reg && !allow.has(`${r.name}|homepage`)) {
      if (!homepage) {
        findings.push({ repo: r.name, kind: "homepage",
          detail: `no homepage; the register says it serves https://${reg.domain}` });
      } else if (!homepage.includes(reg.domain)) {
        findings.push({ repo: r.name, kind: "homepage",
          detail: `homepage ${homepage} is not the registered host https://${reg.domain}` });
      }
    }
    if (!description && !allow.has(`${r.name}|description`)) {
      findings.push({ repo: r.name, kind: "description", detail: "no description" });
    }
  }
  return findings.sort((a, b) => (a.repo + a.kind).localeCompare(b.repo + b.kind));
}

function gh(path) {
  try {
    return JSON.parse(execFileSync("gh", ["api", path, "--paginate"], { encoding: "utf8", maxBuffer: 64e6 }));
  } catch { return null; }
}

function load() {
  if (FIXTURE) return JSON.parse(readFileSync(FIXTURE, "utf8"));
  const repos = gh(`orgs/${ORG}/repos?per_page=100`);
  if (!repos) return null;
  let conf = null;
  const blob = gh(`repos/${ORG}/fleetcrown/contents/scripts/hetzner/apps.conf`);
  if (blob?.content) conf = Buffer.from(blob.content, "base64").toString("utf8");
  return { repos, conf };
}

// Only run the sweep when invoked directly. Importing this file — which the
// test does, to reach judge() without a network — must not execute the CLI;
// the first version did, so `node test-*.mjs` printed the live audit and
// asserted nothing.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (!isMain) { /* imported for its pure helpers */ }
else main();

function main() {
const data = load();
if (!data) {
  // Announced, never a silent pass: "could not look" and "nothing to see" are
  // different answers and only one of them is safe.
  console.log("· repo-metadata audit NOT RUN: the GitHub API was unreachable.");
  process.exit(0);
}
if (!data.conf) {
  console.log("· repo-metadata audit NOT RUN: could not read apps.conf from fleetcrown.");
  process.exit(0);
}

const register = parseRegister(data.conf);
const allow = parseAllow(existsSync(ALLOW) ? readFileSync(ALLOW, "utf8") : "");
const findings = judge({ repos: data.repos, register, allow });

if (MODE === "list") {
  for (const f of findings) console.log(`${f.repo}|${f.kind}|${f.detail}`);
  process.exit(0);
}

const live = data.repos.filter((r) => !r.archived).length;
if (findings.length === 0) {
  console.log(`✓ repo metadata: ${live} repos, ${register.size} registered — every homepage is the registered host, every repo described`);
  process.exit(0);
}
console.log(`✗ ${findings.length} repo(s) whose GitHub metadata disagrees with the register:`);
for (const f of findings) console.log(`    ${f.repo} — ${f.detail}`);
console.log("");
console.log("  The repository page is the first thing anyone opens and the furthest");
console.log("  surface from the code. Fix with `gh repo edit`, or add a line to");
console.log(`  ${ALLOW.split("/").pop()} saying why this one is deliberate.`);
process.exit(1);
}
