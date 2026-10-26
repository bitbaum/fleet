import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyIdentity } from "./package-rollout-gate.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function auditComposition(
  dir,
  baseline = JSON.parse(
    readFileSync(join(root, "registers/product-building-blocks.json"), "utf8"),
  ),
) {
  const findings = [];
  const read = (file) => readFileSync(resolve(dir, file), "utf8");
  if (!existsSync(resolve(dir, "package-plan.json")))
    return [
      "Missing package-plan.json: inventory shared building blocks before implementation.",
    ];
  let plan, manifest;
  try {
    plan = JSON.parse(read("package-plan.json"));
    manifest = JSON.parse(read("package.json"));
  } catch {
    return ["Package plan and package manifest must be valid JSON."];
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const decisions = {
    ...Object.fromEntries(
      Object.entries(plan.blocks ?? {}).map(([key, entry]) => [
        key,
        { package: entry.package },
      ]),
    ),
    ...baseline,
  };
  for (const [feature, required] of Object.entries(decisions)) {
    const entry = plan.blocks?.[feature];
    if (!entry) {
      findings.push(`${feature}: missing building-block decision`);
      continue;
    }
    if (entry.exception) {
      if (
        typeof entry.exception !== "string" ||
        entry.exception.trim().length < 40
      )
        findings.push(
          `${feature}: explain the actual incompatibility or why the feature is absent`,
        );
      continue;
    }
    if (entry.package !== required.package)
      findings.push(
        `${feature}: expected ${required.package}, or document the specific exception`,
      );
    const installedNames = Object.entries(deps)
      .filter(
        ([name, spec]) => dependencyIdentity(name, spec) === entry.package,
      )
      .map(([name]) => name);
    if (!installedNames.length)
      findings.push(`${feature}: ${entry.package} is not installed`);
    if (!Array.isArray(entry.bindings) || entry.bindings.length === 0) {
      findings.push(`${feature}: no rendered/runtime binding declared`);
      continue;
    }
    for (const binding of entry.bindings) {
      if (
        !binding.file ||
        resolve(dir, binding.file).startsWith(resolve(dir) + "/") === false ||
        !existsSync(resolve(dir, binding.file))
      ) {
        findings.push(
          `${feature}: binding file is missing or outside this repository`,
        );
        continue;
      }
      const source = read(binding.file);
      const importNames = [entry.package, ...installedNames].map((name) =>
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      const importsPackage = importNames.some((name) =>
        new RegExp(`(?:from\\s*|import\\s*)['"]${name}(?:/[^'"]*)?['"]`).test(
          source,
        ),
      );
      if (!importsPackage)
        findings.push(
          `${feature}: ${binding.file} does not import its declared package`,
        );
      const usageSources = [];
      for (const file of binding.usageFiles ?? []) {
        if (
          !file ||
          file.startsWith("/") ||
          file.split("/").includes("..") ||
          !existsSync(resolve(dir, file))
        ) {
          findings.push(`${feature}: usage file is missing or outside this repository`);
          continue;
        }
        usageSources.push(read(file));
      }
      const bindingSources = [source, ...usageSources];
      for (const symbol of binding.symbols ?? []) {
        const escaped = String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const used = new RegExp(`(?:<${escaped}\\b|\\b${escaped}\\s*\\()`);
        if (!bindingSources.some((content) => used.test(content)))
          findings.push(`${feature}: ${symbol} is not used in ${binding.file}`);
      }
    }
    for (const surface of entry.surfaces ?? []) {
      if (
        !surface ||
        surface.startsWith("/") ||
        surface.split("/").includes("..") ||
        !existsSync(resolve(dir, surface))
      )
        findings.push(`${feature}: required product surface is missing or unsafe: ${surface}`);
    }
  }
  if (
    !existsSync(resolve(dir, ".github/dependabot.yml")) ||
    !/package-ecosystem:\s*["']?npm/.test(read(".github/dependabot.yml"))
  )
    findings.push(
      "No npm dependency-update path: shared releases cannot propagate.",
    );
  if (!existsSync(resolve(dir, ".github/workflows/auto-merge.yml")))
    findings.push("No checked merge path for shared dependency updates.");
  if (!existsSync(resolve(dir, ".github/workflows/deploy.yml")))
    findings.push("No deployment path for merged shared dependency updates.");
  return findings;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const at = process.argv.indexOf("--dir");
  const dir = resolve(at >= 0 ? process.argv[at + 1] : ".");
  const findings = auditComposition(dir);
  if (findings.length) {
    for (const finding of findings) process.stderr.write(finding + "\n");
    process.exitCode = 1;
  } else
    process.stdout.write(
      "Shared building blocks are installed and wired; dependency updates are configured.\n",
    );
}
