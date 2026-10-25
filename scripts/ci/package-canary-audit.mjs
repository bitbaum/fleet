import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A configured canary must actually execute the package it is meant to exercise. */
export async function auditCanaries(settings, readEvidence) {
  const findings = [];
  for (const [name, entry] of Object.entries(settings.packages ?? {})) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(entry.canary ?? "")) {
      findings.push(`${name}: invalid or absent canary repository`);
      continue;
    }
    let evidence;
    try {
      evidence = await readEvidence(entry.canary);
    } catch {
      findings.push(`${name}: canary evidence unavailable for ${entry.canary}`);
      continue;
    }
    const { manifest, plan, readSource } = evidence;
    const dependencies = {
      ...manifest?.dependencies,
      ...manifest?.devDependencies,
    };
    if (!dependencies[name]) {
      findings.push(`${name}: ${entry.canary} does not declare this package`);
      continue;
    }
    const blocks = Object.values(plan?.blocks ?? {}).filter(
      (block) => block.package === name && !block.exception,
    );
    let bound = false;
    for (const block of blocks) {
      for (const binding of block.bindings ?? []) {
        const source = await readSource(binding.file);
        // A comment naming a package is not an import. Test actual import syntax.
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          !new RegExp(
            `(?:from\\s*|import\\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
          ).test(source ?? "")
        )
          continue;
        if (binding.symbols?.length) {
          bound ||= binding.symbols.some((symbol) => {
            const safe = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(?:<${safe}\\b|\\b${safe}\\s*\\()`).test(source);
          });
        } else if (/design-tokens$/.test(name)) bound = true;
      }
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
      }),
    );
  const file = (repo, path, ref) => {
    const value = api(
      `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
    return Buffer.from(value.content, "base64").toString();
  };
  const findings = await auditCanaries(settings, async (repo) => {
    if (!cache.has(repo)) {
      const tip = api(`repos/${repo}/commits/HEAD`).sha;
      cache.set(repo, {
        manifest: JSON.parse(file(repo, "package.json", tip)),
        plan: JSON.parse(file(repo, "package-plan.json", tip)),
        readSource: async (path) => {
          if (!path || path.startsWith("/") || path.split("/").includes(".."))
            return null;
          return file(repo, path, tip);
        },
      });
    }
    return cache.get(repo);
  });
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Every configured package canary declares and binds its package.",
    );
}
