import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyIdentity } from "./package-rollout-gate.mjs";

/** A configured canary must actually execute the package it is meant to exercise. */
export async function auditCanaries(settings, readEvidence) {
  const findings = [];
  for (const [name, entry] of Object.entries(settings.packages ?? {})) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(entry.canary ?? "")) {
      findings.push(`${name}: invalid or absent canary repository`);
      continue;
    }
    const receiptProjects =
      entry.receiptProjects ??
      [entry.receiptProject ?? entry.canaryImporter ?? "."];
    const requiredReceiptProjects = new Set(
      [entry.receiptProject, entry.canaryImporter].filter(Boolean),
    );
    if (!requiredReceiptProjects.size) requiredReceiptProjects.add(".");
    if (
      !Array.isArray(receiptProjects) ||
      receiptProjects.some((project) => typeof project !== "string") ||
      [...requiredReceiptProjects].some((project) => !receiptProjects.includes(project))
    ) {
      findings.push(
        `${name}: release receipt does not cover configured canary importers ${[...requiredReceiptProjects].join(", ")}`,
      );
      continue;
    }
    let evidence;
    try {
      evidence = await readEvidence(entry.canary, entry.bootstrapPr ?? null);
    } catch {
      findings.push(`${name}: canary evidence unavailable for ${entry.canary}`);
      continue;
    }
    const { manifest, plan, readSource, manifestForSource } = evidence;
    const blocks = Object.values(plan?.blocks ?? {}).filter(
      (block) => block.package === name && !block.exception,
    );
    const manifestDependencies = {
      ...manifest?.dependencies,
      ...manifest?.devDependencies,
      ...manifest?.optionalDependencies,
    };
    const declaredAtRoot = Object.entries(manifestDependencies).some(
      ([dependency, spec]) => dependencyIdentity(dependency, spec) === name,
    );
    if (declaredAtRoot && !blocks.length) {
      findings.push(`${name}: ${entry.canary} has no declared runtime binding`);
      continue;
    }
    if (!declaredAtRoot && (!manifestForSource || !blocks.length)) {
      findings.push(`${name}: ${entry.canary} does not declare this package`);
      continue;
    }
    let declared = false;
    let bound = false;
    for (const block of blocks) {
      for (const binding of block.bindings ?? []) {
        const bindingManifest = (await manifestForSource?.(binding.file)) ?? manifest;
        const dependencies = {
          ...bindingManifest?.dependencies,
          ...bindingManifest?.devDependencies,
          ...bindingManifest?.optionalDependencies,
        };
        const installedNames = Object.entries(dependencies)
          .filter(
            ([dependency, spec]) => dependencyIdentity(dependency, spec) === name,
          )
          .map(([dependency]) => dependency);
        if (!installedNames.length) continue;
        declared = true;
        const source = await readSource(binding.file);
        // A comment naming a package is not an import. Test actual import syntax.
        const importedNames = [name, ...installedNames].some((dependency) => {
          const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(
            `(?:from\\s*|import\\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
          ).test(source ?? "");
        });
        if (!importedNames)
          continue;
        if (binding.symbols?.length) {
          const usageSources = await Promise.all(
            (binding.usageFiles ?? []).map((path) => readSource(path)),
          );
          const bindingSources = [source, ...usageSources].filter(
            (value) => typeof value === "string",
          );
          bound ||= binding.symbols.some((symbol) => {
            const safe = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const used = new RegExp(
              `(?:<${safe}\\b|\\b${safe}\\s*\\()`,
            );
            return bindingSources.some((content) => used.test(content));
          });
        } else if (/design-tokens$/.test(name)) bound = true;
      }
    }
    if (!declared) {
      findings.push(`${name}: ${entry.canary} does not declare this package`);
      continue;
    }
    if (!bound)
      findings.push(`${name}: ${entry.canary} has no declared runtime binding`);
  }
  return findings;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const settings = JSON.parse(
    readFileSync(
      new URL("../../registers/package-rollouts.json", import.meta.url),
    ),
  );
  const cache = new Map();
  const api = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // Large monorepos (OrangeCat has >5k tracked blobs) can exceed
        // Node's 1 MiB default even though GitHub returned complete evidence.
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  const file = (repo, path, ref) => {
    const value = api(
      `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
    return Buffer.from(value.content, "base64").toString();
  };
  const tree = (repo, ref) => {
    const value = api(`repos/${repo}/git/trees/${ref}?recursive=1`);
    if (value.truncated) throw new Error(`${repo}@${ref} tree is truncated`);
    return new Set(
      (value.tree ?? [])
        .filter((item) => item.type === "blob" && /(^|\/)package\.json$/.test(item.path))
        .map((item) => item.path),
    );
  };
  const findings = await auditCanaries(settings, async (repo, bootstrapPr) => {
    let ref = api(`repos/${repo}/commits/HEAD`).sha;
    if (bootstrapPr != null) {
      const pr = api(`repos/${repo}/pulls/${bootstrapPr}`);
      if (pr.state === "open") {
        const defaultBranch = api(`repos/${repo}`).default_branch;
        if (
          pr.head?.repo?.full_name !== repo ||
          pr.base?.repo?.full_name !== repo ||
          pr.base?.ref !== defaultBranch
        )
          throw new Error(`${repo}#${bootstrapPr} is not an in-repository default-branch PR`);
        ref = pr.head.sha;
      } else if (!pr.merged) {
        throw new Error(`${repo}#${bootstrapPr} is closed without merging`);
      }
    }
    const cacheKey = `${repo}@${ref}`;
    if (!cache.has(cacheKey)) {
      const manifestPaths = tree(repo, ref);
      const manifestCache = new Map();
      const readManifest = (path) => {
        if (!manifestPaths.has(path)) return null;
        if (!manifestCache.has(path)) manifestCache.set(path, JSON.parse(file(repo, path, ref)));
        return manifestCache.get(path);
      };
      cache.set(cacheKey, {
        manifest: readManifest("package.json"),
        plan: JSON.parse(file(repo, "package-plan.json", ref)),
        manifestForSource: async (sourcePath) => {
          if (!sourcePath || sourcePath.startsWith("/") || sourcePath.split("/").includes("..")) return null;
          const parts = sourcePath.split("/");
          for (let i = parts.length - 1; i >= 0; i--) {
            const candidate = [...parts.slice(0, i), "package.json"].join("/");
            const value = readManifest(candidate);
            if (value) return value;
          }
          return readManifest("package.json");
        },
        readSource: async (path) => {
          if (!path || path.startsWith("/") || path.split("/").includes(".."))
            return null;
          return file(repo, path, ref);
        },
      });
    }
    return cache.get(cacheKey);
  });
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Every configured package canary declares and binds its package.",
    );
}
