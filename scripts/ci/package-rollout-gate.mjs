import { createHash } from "node:crypto";
import { receiptMatches } from "./release-receipt-contract.mjs";
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
export function dependencyIdentity(name, spec) {
  if (typeof spec === "string" && spec.startsWith("npm:")) {
    const target = spec.slice(4),
      split = target.lastIndexOf("@");
    if (split > target.indexOf("/")) return target.slice(0, split);
  }
  if (typeof spec === "string") {
    const git =
      /^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?#/.exec(
        spec,
      );
    if (git)
      return (
        registry.packages.find(
          (entry) => entry.repo === `https://github.com/${git[1]}`,
        )?.name ?? name
      );
  }
  return name;
}
const shared = (name) =>
  known.has(name) || name.startsWith("@bitbaum/") || policy.packages[name];
export function lockedDependencies(manifest, lock, importer = ".") {
  const deps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  const result = {};
  // Callers select the importer explicitly; peer contexts do not change artifact identity.
  const importers =
    lock.match(/^importers:[^\n]*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1] ?? "";
  const escapedImporter = importer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const root =
    importers.match(
      new RegExp(
        `^  (?:${escapedImporter}|["']${escapedImporter}["']):[^\\n]*\\n([\\s\\S]*?)(?=^  \\S|^\\S|(?![\\s\\S]))`,
        "m",
      ),
    )?.[1] ?? "";
  for (const [name, spec] of Object.entries(deps)) {
    const identity = dependencyIdentity(name, spec);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const version = root.match(
      new RegExp(
        `^      ['"]?${escaped}['"]?:\\s*\\n\\s+specifier:.*\\n\\s+version: (.+)$`,
        "m",
      ),
    )?.[1];
    if (!version && shared(identity))
      throw new Error(`Missing locked artifact for ${name}`);
    let artifact = version?.replace(/^['"]|['"]$/g, "").split("(")[0] ?? spec;
    // pnpm prefixes aliased npm AND Git resolutions with the target identity.
    if (artifact.startsWith(`${identity}@`))
      artifact = artifact.slice(identity.length + 1);
    if (result[identity] && result[identity] !== artifact && shared(identity))
      throw new Error(`Conflicting locked artifacts for ${identity}`);
    result[identity] = artifact;
  }
  return result;
}
export function lockedNpmDependencies(manifest, lock, importer = ".") {
  const deps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages)
    throw new Error("Unsupported npm lockfile: artifact evidence is missing");
  const prefix = importer === "." ? "" : importer.replace(/\/$/, "") + "/";
  const result = {};
  for (const [name, spec] of Object.entries(deps)) {
    const identity = dependencyIdentity(name, spec);
    const entry =
      lock.packages[`${prefix}node_modules/${name}`] ??
      lock.packages[`node_modules/${name}`];
    const artifact =
      entry?.resolved && /git|codeload/.test(entry.resolved)
        ? entry.resolved
        : entry?.version;
    if (!artifact && shared(identity))
      throw new Error(`Missing locked artifact for ${name}`);
    if (result[identity] && result[identity] !== artifact && shared(identity))
      throw new Error(`Conflicting locked artifacts for ${identity}`);
    result[identity] = artifact ?? "unresolved";
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
export function nestedSharedUpdates(beforeLock, afterLock) {
  const before = new Map(
    nestedSharedArtifacts(beforeLock).map(([importer, name, version]) => [
      `${importer}\0${name}`,
      version,
    ]),
  );
  return nestedSharedArtifacts(afterLock).filter(
    ([importer, name, version]) => before.get(`${importer}\0${name}`) !== version,
  );
}
export function nestedSharedChange(files, readManifest) {
  const sharedSpecs = (manifest) =>
    Object.fromEntries(
      Object.entries({
        ...manifest?.dependencies,
        ...manifest?.devDependencies,
      })
        .map(([name, spec]) => [dependencyIdentity(name, spec), spec])
        .filter(([name]) => shared(name))
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
    const beforeManifest = readManifest(path, "base");
    const afterManifest = readManifest(path, "head");
    // A deleted workspace package is retired, not a nested consumer whose
    // shared dependency update needs importer-specific rollout evidence.
    if (!afterManifest) continue;
    const before = sharedSpecs(beforeManifest),
      after = sharedSpecs(afterManifest);
    if (isLock && Object.keys(after).length)
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
  requiredChecks = ["ci.yml", "browser-smoke.yml"],
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
        settings.packages?.[name]
      )
    )
      continue;
    if (settings.blocked?.[name]?.includes(version)) {
      findings.push(`${name}@${version}: release is blocked`);
      continue;
    }
    const config = settings.packages?.[name];
    if (!config) {
      findings.push(
        `${name}: no designated canary; configure one before automatic promotion`,
      );
      continue;
    }
    const candidateRequired = config.candidateChecks ?? requiredChecks;
    if (!candidateRequired.every((check) => candidateChecks.includes(check))) {
      findings.push(
        `${name}: consumer needs successful ${candidateRequired.join(" and ")} workflows on this commit`,
      );
      continue;
    }
    if (repo === config.canary) continue;
    const canary = await readCanary(config.canary, config, name);
    if (
      !canary ||
      canary.dependencies[name] !== version ||
      !canary.healthy ||
      !(config.canaryChecks ?? ["ci.yml", "browser-smoke.yml"]).every((check) =>
        canary.checks?.includes(check),
      ) ||
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
  const dependencies = {
    ...parsed.dependencies,
    ...parsed.devDependencies,
    ...parsed.optionalDependencies,
  };
  const names = Object.keys(dependencies);
  if (!names.some((n) => shared(dependencyIdentity(n, dependencies[n]))))
    return {};
  const lock = content(repo, "pnpm-lock.yaml", ref);
  if (lock) return lockedDependencies(parsed, lock);
  const npm = content(repo, "package-lock.json", ref);
  if (npm) return lockedNpmDependencies(parsed, JSON.parse(npm));

  throw new Error(
    `${repo}: supported lockfile required for artifact-specific rollout evidence`,
  );
}
function workspaceDepsAt(repo, ref, importer) {
  const rawManifest = content(repo, `${importer}/package.json`, ref);
  if (!rawManifest) return {};
  const parsed = JSON.parse(rawManifest);
  const dependencies = {
    ...parsed.dependencies,
    ...parsed.devDependencies,
    ...parsed.optionalDependencies,
  };
  if (
    !Object.entries(dependencies).some(([name, spec]) =>
      shared(dependencyIdentity(name, spec)),
    )
  )
    return {};
  const lock = content(repo, "pnpm-lock.yaml", ref);
  if (lock) return lockedDependencies(parsed, lock, importer);
  const npm = content(repo, "package-lock.json", ref);
  if (npm) return lockedNpmDependencies(parsed, JSON.parse(npm), importer);
  throw new Error(
    `${repo}/${importer}: supported lockfile required for artifact-specific rollout evidence`,
  );
}
function standaloneDepsAt(repo, ref, project) {
  const rawManifest = content(repo, `${project}/package.json`, ref);
  if (!rawManifest) return {};
  const parsed = JSON.parse(rawManifest);
  const lock =
    content(repo, `${project}/pnpm-lock.yaml`, ref) ??
    content(repo, `${project}/package-lock.json`, ref);
  if (!lock) {
    const dependencies = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.optionalDependencies,
    };
    if (
      Object.entries(dependencies).some(([name, spec]) =>
        shared(dependencyIdentity(name, spec)),
      )
    )
      throw new Error(
        `${repo}/${project}: standalone shared dependencies require a committed lockfile`,
      );
    return {};
  }
  if (content(repo, `${project}/pnpm-lock.yaml`, ref))
    return lockedDependencies(parsed, lock);
  return lockedNpmDependencies(parsed, JSON.parse(lock));
}
function rootHasImporter(lock, importer) {
  const section =
    lock.match(/^importers:[^\n]*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1] ?? "";
  const escaped = importer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^  (?:${escaped}|['"]${escaped}['"]):`, "m").test(section);
}
function canaryDepsAt(repo, ref, config) {
  const importer = config.canaryImporter;
  if (!importer) return depsAt(repo, ref);
  if (
    typeof importer !== "string" ||
    importer.startsWith("/") ||
    importer.split("/").some((part) => !part || part === "." || part === "..") ||
    importer.includes("\\")
  )
    throw new Error(`${repo}: invalid canary importer path`);
  return workspaceDepsAt(repo, ref, importer);
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
/** Shared by root and starter consumers: a green deploy cannot override a stale receipt. */
export async function canaryDeploymentEvidence({
  canary,
  tip,
  dependencies,
  deploy,
  checks,
  requiredChecks = ["ci.yml", "browser-smoke.yml"],
  receiptUrl,
  lock,
  fetchImpl = fetch,
}) {
  let receiptHealthy = true;
  if (receiptUrl) {
    const url = new URL(receiptUrl);
    if (url.protocol !== "https:")
      throw new Error("Deployment receipts require HTTPS");
    url.searchParams.set("commit", tip);
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `${canary}: deployment receipt returned HTTP ${response.status}`,
      );
    const receipt = await response.json();
    if (!lock) throw new Error(`${canary}: receipt lockfile is unavailable`);
    receiptHealthy = receiptMatches(receipt, {
      repo: canary,
      commit: tip,
      artifacts: Object.fromEntries(
        Object.entries(dependencies).filter(([name]) => shared(name)),
      ),
      lockSha256: createHash("sha256").update(lock).digest("hex"),
    });
    if (!receiptHealthy)
      console.error(
        `${canary}: live receipt does not match the current commit and locked artifacts`,
      );
  }
  return {
    dependencies,
    healthy:
      receiptHealthy &&
      deploy?.conclusion === "success" &&
      deploy.head_sha === tip &&
      requiredChecks.every((check) => checks.includes(check)),
    checks,
    deployedAt: deploy?.updated_at,
  };
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
  // The app starter is a supported consumer in its own right. Its CI runs a
  // clean install, package verification, production build and auth journey.
  // Keep all other nested consumers held until they have equivalent evidence.
  const templateFiles = files.filter(({ filename }) =>
    /^templates\/app\/(?:package\.json|pnpm-lock\.yaml)$/.test(filename),
  );
  if (templateFiles.length) {
    const templateDeps = (sha) => {
      const rawManifest = content(repo, "templates/app/package.json", sha);
      if (!rawManifest) return {};
      const templateManifest = JSON.parse(rawManifest);
      const lock = content(repo, "templates/app/pnpm-lock.yaml", sha);
      if (!lock)
        throw new Error("templates/app requires a committed pnpm lockfile");
      return lockedDependencies(templateManifest, lock);
    };
    const beforeTemplate = templateDeps(pr.base.sha);
    const afterTemplate = templateDeps(pr.head.sha);
    const changed = Object.keys(afterTemplate).some(
      (name) =>
        beforeTemplate[name] !== afterTemplate[name] &&
        (known.has(name) ||
          name.startsWith("@bitbaum/") ||
          policy.packages[name]),
    );
    if (changed) {
      const cache = new Map();
      const findings = await assessRollout({
        repo,
        before: beforeTemplate,
        after: afterTemplate,
        candidateChecks: greenWorkflows(repo, pr.head.sha),
        requiredChecks: ["ci.yml"],
        readCanary: async (canary, config) => {
          const requiredChecks = config.canaryChecks ?? ["ci.yml", "browser-smoke.yml"];
          const cacheKey = `${canary}:${requiredChecks.join(",")}`;
          if (cache.has(cacheKey)) return cache.get(cacheKey);
          const branch = api(`repos/${canary}`).default_branch;
          const tip = api(`repos/${canary}/commits/${branch}`).sha;
          const deploy = api(
            `repos/${canary}/actions/workflows/deploy.yml/runs?branch=${branch}&per_page=1`,
          ).workflow_runs[0];
          const checks = greenWorkflows(canary, tip);
          const result = await canaryDeploymentEvidence({
            canary,
            tip,
            dependencies: canaryDepsAt(canary, tip, config),
            deploy,
            checks,
            requiredChecks,
            receiptUrl: policy.deploymentReceipts?.[canary],
            lock:
              content(canary, "pnpm-lock.yaml", tip) ??
              content(canary, "package-lock.json", tip),
          });
          cache.set(cacheKey, result);
          return result;
        },
      });
      if (findings.length) {
        console.log(findings.join("\n"));
        process.exitCode = 1;
      }
    }
  }
  if (!manifest) return;
  // Workspace artifacts cannot silently escape the root-consumer gate.
  const baseLock = content(repo, "pnpm-lock.yaml", pr.base.sha) ?? "";
  const headLock = content(repo, "pnpm-lock.yaml", pr.head.sha) ?? "";
  const rootImporters = new Set(
    nestedSharedUpdates(baseLock, headLock).map(([importer]) => importer),
  );
  const standaloneProjects = new Set();
  const canaryCache = new Map();
  for (const { filename } of files) {
    if (filename.startsWith("templates/app/")) continue;
    const isManifest = filename.endsWith("/package.json");
    const isLock = /\/(?:pnpm-lock\.yaml|package-lock\.json)$/.test(filename);
    if (!isManifest && !isLock) continue;
    const project = filename.slice(0, filename.lastIndexOf("/"));
    if (!project) continue;
    if (
      content(repo, `${project}/pnpm-lock.yaml`, pr.base.sha) ||
      content(repo, `${project}/package-lock.json`, pr.base.sha) ||
      content(repo, `${project}/pnpm-lock.yaml`, pr.head.sha) ||
      content(repo, `${project}/package-lock.json`, pr.head.sha)
    ) {
      standaloneProjects.add(project);
    } else if (
      rootHasImporter(baseLock, project) ||
      rootHasImporter(headLock, project)
    ) {
      rootImporters.add(project);
    } else if (isManifest) {
      const beforeRaw = content(repo, filename, pr.base.sha);
      const afterRaw = content(repo, filename, pr.head.sha);
      const sharedEntries = (raw) => {
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Object.entries({
          ...parsed.dependencies,
          ...parsed.devDependencies,
          ...parsed.optionalDependencies,
        }).filter(([name, spec]) => shared(dependencyIdentity(name, spec)));
      };
      if (
        JSON.stringify(sharedEntries(beforeRaw)) !==
        JSON.stringify(sharedEntries(afterRaw))
      )
        throw new Error(
          `${project}: nested shared dependency update has no importer-specific lock evidence; automatic promotion is held`,
        );
    }
  }
  for (const importer of rootImporters) {
    if (!content(repo, `${importer}/package.json`, pr.head.sha))
      throw new Error(
        `${importer}: nested shared lock update has no matching manifest; automatic promotion is held`,
      );
    const beforeNested = workspaceDepsAt(repo, pr.base.sha, importer);
    const afterNested = workspaceDepsAt(repo, pr.head.sha, importer);
    const changedNested = Object.keys(afterNested).some(
      (name) =>
        beforeNested[name] !== afterNested[name] &&
        (known.has(name) || name.startsWith("@bitbaum/") || policy.packages[name]),
    );
    if (!changedNested) continue;
    const findings = await assessRollout({
      repo,
      before: beforeNested,
      after: afterNested,
      candidateChecks: greenWorkflows(repo, pr.head.sha),
      requiredChecks: ["ci.yml"],
      readCanary: async (canary, config) => {
        const requiredChecks = config.canaryChecks ?? ["ci.yml", "browser-smoke.yml"];
        const cacheKey = `${canary}:${requiredChecks.join(",")}`;
        if (canaryCache.has(cacheKey)) return canaryCache.get(cacheKey);
        const branch = api(`repos/${canary}`).default_branch;
        const tip = api(`repos/${canary}/commits/${branch}`).sha;
        const deploy = api(
          `repos/${canary}/actions/workflows/deploy.yml/runs?branch=${branch}&per_page=1`,
        ).workflow_runs[0];
        const checks = greenWorkflows(canary, tip);
        const result = await canaryDeploymentEvidence({
          canary,
          tip,
          dependencies: canaryDepsAt(canary, tip, config),
          deploy,
          checks,
          requiredChecks,
          receiptUrl: policy.deploymentReceipts?.[canary],
          lock:
            content(canary, "pnpm-lock.yaml", tip) ??
            content(canary, "package-lock.json", tip),
        });
        canaryCache.set(cacheKey, result);
        return result;
      },
    });
    if (findings.length) {
      console.log(findings.join("\n"));
      process.exitCode = 1;
    }
  }
  for (const project of standaloneProjects) {
    const beforeNested = standaloneDepsAt(repo, pr.base.sha, project);
    const afterNested = standaloneDepsAt(repo, pr.head.sha, project);
    const changedNested = Object.keys(afterNested).some(
      (name) =>
        beforeNested[name] !== afterNested[name] &&
        (known.has(name) || name.startsWith("@bitbaum/") || policy.packages[name]),
    );
    if (!changedNested) continue;
    const findings = await assessRollout({
      repo,
      before: beforeNested,
      after: afterNested,
      candidateChecks: greenWorkflows(repo, pr.head.sha),
      requiredChecks: ["ci.yml"],
      readCanary: async (canary, config) => {
        const requiredChecks = config.canaryChecks ?? ["ci.yml", "browser-smoke.yml"];
        const cacheKey = `${canary}:${requiredChecks.join(",")}`;
        if (canaryCache.has(cacheKey)) return canaryCache.get(cacheKey);
        const branch = api(`repos/${canary}`).default_branch;
        const tip = api(`repos/${canary}/commits/${branch}`).sha;
        const deploy = api(
          `repos/${canary}/actions/workflows/deploy.yml/runs?branch=${branch}&per_page=1`,
        ).workflow_runs[0];
        const checks = greenWorkflows(canary, tip);
        const result = await canaryDeploymentEvidence({
          canary,
          tip,
          dependencies: canaryDepsAt(canary, tip, config),
          deploy,
          checks,
          requiredChecks,
          receiptUrl: policy.deploymentReceipts?.[canary],
          lock:
            content(canary, "pnpm-lock.yaml", tip) ??
            content(canary, "package-lock.json", tip),
        });
        canaryCache.set(cacheKey, result);
        return result;
      },
    });
    if (findings.length) {
      console.log(findings.join("\n"));
      process.exitCode = 1;
    }
  }
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
    readCanary: async (canary, config) => {
      const requiredChecks = config.canaryChecks ?? ["ci.yml", "browser-smoke.yml"];
      const cacheKey = `${canary}:${requiredChecks.join(",")}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const branch = api(`repos/${canary}`).default_branch;
      const tip = api(`repos/${canary}/commits/${branch}`).sha;
      const deploy = api(
        `repos/${canary}/actions/workflows/deploy.yml/runs?branch=${branch}&per_page=1`,
      ).workflow_runs[0];
      const checks = greenWorkflows(canary, tip);
      const result = await canaryDeploymentEvidence({
        canary,
        tip,
        dependencies: canaryDepsAt(canary, tip, config),
        deploy,
        checks,
        requiredChecks,
        receiptUrl: policy.deploymentReceipts?.[canary],
        lock:
          content(canary, "pnpm-lock.yaml", tip) ??
          content(canary, "package-lock.json", tip),
      });
      cache.set(cacheKey, result);
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
