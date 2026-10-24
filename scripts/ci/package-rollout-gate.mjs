import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const policy = JSON.parse(
  readFileSync(
    new URL("../../registers/package-rollouts.json", import.meta.url),
    "utf8",
  ),
);
const registry = JSON.parse(
  readFileSync(
    new URL("../../registers/packages.json", import.meta.url),
    "utf8",
  ),
);
const known = new Set(registry.packages.map((p) => p.name));
export function lockedDependencies(manifest, lock) {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const result = {};
  // Read pnpm's root importer only; peer contexts do not change the artifact identity.
  const root =
    lock.match(/^  \.:\s*\n([\s\S]*?)(?=^  \S|^\S|(?![\s\S]))/m)?.[1] ?? "";
  for (const [name, spec] of Object.entries(deps)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const version = root.match(
      new RegExp(
        `^      ['"]?${escaped}['"]?:\\s*\\n\\s+specifier:.*\\n\\s+version: (.+)$`,
        "m",
      ),
    )?.[1];
    if (
      !version &&
      (known.has(name) || name.startsWith("@bitbaum/") || policy.packages[name])
    )
      throw new Error(`Missing locked artifact for ${name}`);
    result[name] = version?.replace(/^['"]|['"]$/g, "").split("(")[0] ?? spec;
  }
  return result;
}
export function nestedSharedArtifacts(lock) {
  const section =
    lock.match(/^importers:[^\n]*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1] ?? "";
  const entries = [];
  for (const importer of section.matchAll(
    /^  (.+):[^\n]*\n([\s\S]*?)(?=^  \S|^\S|(?![\s\S]))/gm,
  )) {
    if (importer[1].replace(/['"]/g, "") === ".") continue;
    for (const dependency of importer[2].matchAll(
      /^      ['"]?([^'"\n]+?)['"]?:\s*\n\s+specifier:.*\n\s+version: (.+)$/gm,
    )) {
      const name = dependency[1];
      if (
        known.has(name) ||
        name.startsWith("@bitbaum/") ||
        policy.packages[name]
      )
        entries.push([
          importer[1],
          name,
          dependency[2].replace(/^['"]|['"]$/g, "").split("(")[0],
        ]);
    }
  }
  return entries.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}
export function nestedSharedChange(files, readManifest) {
  const sharedSpecs = (manifest) =>
    Object.fromEntries(
      Object.entries({
        ...manifest?.dependencies,
        ...manifest?.devDependencies,
      })
        .filter(
          ([name]) =>
            known.has(name) ||
            name.startsWith("@bitbaum/") ||
            policy.packages[name],
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  for (const { filename } of files) {
    if (!filename.includes("/")) continue;
    const isManifest = filename.endsWith("/package.json");
    const isLock = /\/(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(
      filename,
    );
    if (!isManifest && !isLock) continue;
    const path = isManifest
      ? filename
      : filename.slice(0, filename.lastIndexOf("/")) + "/package.json";
    const before = sharedSpecs(readManifest(path, "base")),
      after = sharedSpecs(readManifest(path, "head"));
    if (isLock && (Object.keys(before).length || Object.keys(after).length))
      return true;
    if (isManifest && JSON.stringify(before) !== JSON.stringify(after))
      return true;
  }
  return false;
}
export async function assessRollout({
  repo,
  before,
  after,
  readCanary,
  candidateChecks,
  settings = policy,
  now = Date.now(),
}) {
  const findings = [];
  for (const [name, version] of Object.entries(after)) {
    if (
      before[name] === version ||
      !(
        known.has(name) ||
        name.startsWith("@bitbaum/") ||
        settings.packages[name]
      )
    )
      continue;
    if (settings.blocked[name]?.includes(version)) {
      findings.push(`${name}@${version}: release is blocked`);
      continue;
    }
    const config = settings.packages[name];
    if (!config) {
      findings.push(
        `${name}: no designated canary; configure one before automatic promotion`,
      );
      continue;
    }
    if (
      !candidateChecks.includes("ci.yml") ||
      !candidateChecks.includes("browser-smoke.yml")
    ) {
      findings.push(
        `${name}: consumer needs successful CI and browser-smoke workflows on this commit`,
      );
      continue;
    }
    if (repo === config.canary) continue;
    const canary = await readCanary(config.canary);
    if (
      !canary ||
      canary.dependencies[name] !== version ||
      !canary.healthy ||
      now - Date.parse(canary.deployedAt) < settings.soakHours * 3600000 ||
      !Number.isFinite(Date.parse(canary.deployedAt))
    ) {
      findings.push(
        `${name}@${version}: wait for ${config.canary} to deploy this artifact, pass CI/browser checks and soak for ${settings.soakHours}h`,
      );
    }
  }
  return findings;
}
function api(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
function content(repo, path, ref) {
  try {
    const result = api(
      `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
    return Buffer.from(result.content, "base64").toString();
  } catch (error) {
    if (String(error.stderr).includes("404")) return null;
    throw error;
  }
}
function depsAt(repo, ref) {
  const manifest = content(repo, "package.json", ref);
  if (!manifest) return {};
  const parsed = JSON.parse(manifest);
  const names = Object.keys({
    ...parsed.dependencies,
    ...parsed.devDependencies,
  });
  if (
    !names.some(
      (n) => known.has(n) || n.startsWith("@bitbaum/") || policy.packages[n],
    )
  )
    return {};
  const lock = content(repo, "pnpm-lock.yaml", ref);
  if (lock) return lockedDependencies(parsed, lock);
  const npm = content(repo, "package-lock.json", ref);
  if (npm) {
    const packages = JSON.parse(npm).packages;
    if (!packages)
      throw new Error("Unsupported npm lockfile: artifact evidence is missing");
    return Object.fromEntries(
      names.map((n) => {
        const entry = packages[`node_modules/${n}`];
        const artifact =
          entry?.resolved && /git|codeload/.test(entry.resolved)
            ? entry.resolved
            : entry?.version;
        if (
          !artifact &&
          (known.has(n) || n.startsWith("@bitbaum/") || policy.packages[n])
        )
          throw new Error(`Missing locked artifact for ${n}`);
        return [n, artifact ?? "unresolved"];
      }),
    );
  }
  throw new Error(
    `${repo}: supported lockfile required for artifact-specific rollout evidence`,
  );
}
export function successfulWorkflows(runs) {
  const seen = new Set(),
    passed = [];
  for (const run of runs) {
    if (!["push", "pull_request", "workflow_dispatch"].includes(run.event))
      continue;
    const path = run.path?.split("/").at(-1);
    if (seen.has(path)) continue;
    seen.add(path);
    if (run.conclusion === "success") passed.push(path);
  }
  return passed;
}
function greenWorkflows(repo, sha) {
  return successfulWorkflows(
    api(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`)
      .workflow_runs,
  );
}
async function main() {
  const [repo, number] = process.argv.slice(2);
  const pr = api(`repos/${repo}/pulls/${number}`);
  // Avoid requiring a Node lockfile from repositories with no root Node manifest.
  const manifest = content(repo, "package.json", pr.head.sha);
  // Package repositories publish artifacts; their downstream application consumers
  // provide the deployment/canary evidence. Do not require a library to deploy a site.
  if (manifest && known.has(JSON.parse(manifest).name)) return;
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = api(
      `repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) break;
    if (page === 30)
      throw new Error("Dependency scope exceeds the API file limit");
  }
  if (
    nestedSharedChange(files, (path, side) => {
      const text = content(
        repo,
        path,
        side === "base" ? pr.base.sha : pr.head.sha,
      );
      return text ? JSON.parse(text) : null;
    })
  )
    throw new Error(
      "Nested shared dependency update requires importer-specific rollout evidence; automatic merge is held",
    );
  if (!manifest) return;
  // Workspace artifacts cannot silently escape the root-consumer gate.
  const baseLock = content(repo, "pnpm-lock.yaml", pr.base.sha) ?? "";
  const headLock = content(repo, "pnpm-lock.yaml", pr.head.sha) ?? "";
  if (
    JSON.stringify(nestedSharedArtifacts(baseLock)) !==
    JSON.stringify(nestedSharedArtifacts(headLock))
  )
    throw new Error(
      "Nested workspace shared artifacts changed: automatic promotion is held until workspace-specific canary evidence is supported",
    );
  const before = depsAt(repo, pr.base.sha),
    after = depsAt(repo, pr.head.sha);
  const changed = Object.keys(after).some(
    (n) =>
      before[n] !== after[n] &&
      (known.has(n) || n.startsWith("@bitbaum/") || policy.packages[n]),
  );
  if (!changed) return;
  const cache = new Map();
  const findings = await assessRollout({
    repo,
    before,
    after,
    candidateChecks: greenWorkflows(repo, pr.head.sha),
    readCanary: async (canary) => {
      if (cache.has(canary)) return cache.get(canary);
      const branch = api(`repos/${canary}`).default_branch;
      const tip = api(`repos/${canary}/commits/${branch}`).sha;
      const deploy = api(
        `repos/${canary}/actions/workflows/deploy.yml/runs?branch=${branch}&per_page=1`,
      ).workflow_runs[0];
      const checks = greenWorkflows(canary, tip);
      const result = {
        dependencies: depsAt(canary, tip),
        healthy:
          deploy?.conclusion === "success" &&
          deploy.head_sha === tip &&
          checks.includes("ci.yml") &&
          checks.includes("browser-smoke.yml"),
        deployedAt: deploy?.updated_at,
      };
      cache.set(canary, result);
      return result;
    },
  });
  if (findings.length) {
    console.log(findings.join("\n"));
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(`Rollout evidence unavailable: ${error.message}`);
    process.exitCode = 2;
  });
