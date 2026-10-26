import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  dependencyIdentity,
  lockedDependencies,
  lockedNpmDependencies,
} from "./package-rollout-gate.mjs";

import {
  isImmutableArtifact,
  isPackageVersion,
} from "./release-receipt-contract.mjs";
export { receiptMatches } from "./release-receipt-contract.mjs";

const registry = JSON.parse(
  readFileSync(
    new URL("../../registers/packages.json", import.meta.url),
    "utf8",
  ),
);
const known = new Set(registry.packages.map((pkg) => pkg.name));
const isShared = (name) => known.has(name) || name.startsWith("@bitbaum/");
const dependencies = (manifest) => ({
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
});
const digest = (text) => createHash("sha256").update(text).digest("hex");
const isProjectPath = (path) =>
  typeof path === "string" &&
  !path.startsWith("/") &&
  !/[\n\r\\]/.test(path) &&
  (path === "." || path.split("/").every((part) => part && part !== "." && part !== ".."));
/** Only public first-party package metadata; no environment, paths, or product data. */
export function createReleaseReceipt({
  repo,
  commit,
  manifest,
  pnpmLock,
  npmLock,
  importer = ".",
  importers = [importer],
  manifests = {},
  installed = {},
  createdAt = new Date().toISOString(),
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") ||
    !/^[0-9a-f]{40}$/.test(commit ?? "")
  )
    throw new Error("A repository and exact built commit are required");
  if (!isProjectPath(importer))
    throw new Error("Project must be inside the checkout");
  if (
    !Array.isArray(importers) ||
    !importers.length ||
    importers.some((path) => !isProjectPath(path)) ||
    new Set(importers).size !== importers.length
  )
    throw new Error("Receipt importers must be project paths inside the checkout");
  const manifestsByPath = Object.fromEntries(importers.map((path) => [path, path === importer ? manifest : manifests[path]]));
  const wanted = [];
  for (let i = 0; i < importers.length; i++) {
    const path = importers[i];
    const current = manifestsByPath[path];
    if (!current) throw new Error(`${path}: project manifest is required for release receipt`);
    const importerDependencies = Object.entries(dependencies(current)).filter(([name, spec]) => isShared(dependencyIdentity(name, spec)));
    for (const [depName, spec] of importerDependencies) wanted.push({ depName, spec, importer: path });
  }
  if (wanted.length && !pnpmLock && !npmLock)
    throw new Error("Shared packages require a supported lockfile");
  const artifacts = {},
    versions = {};
  for (const { depName, spec, importer: currentImporter } of wanted) {
    const name = dependencyIdentity(depName, spec),
      currentManifest = manifestsByPath[currentImporter],
      locked = pnpmLock
        ? lockedDependencies(currentManifest, pnpmLock, currentImporter)
        : npmLock
          ? lockedNpmDependencies(currentManifest, JSON.parse(npmLock), currentImporter)
          : {},
      artifact = locked[name],
      actual = installed[depName];
    if (!isImmutableArtifact(artifact ?? ""))
      throw new Error(`${name}: immutable locked artifact required`);
    if (!actual?.version || !isPackageVersion(actual.version))
      throw new Error(`${name}: installed package metadata is missing`);
    if (/^\d/.test(artifact) && artifact !== actual.version)
      throw new Error(`${name}: installed package differs from the lockfile`);
    if (artifacts[name] && artifacts[name] !== artifact)
      throw new Error(`${name}: workspace importers resolve different artifacts`);
    artifacts[name] = artifact;
    versions[name] = actual.version;
  }
  return {
    formatVersion: 1,
    repo,
    commit,
    project: importer,
    projects: [...importers],
    createdAt,
    lockSha256: digest(pnpmLock ?? npmLock ?? ""),
    artifacts: Object.fromEntries(Object.entries(artifacts).sort()),
    versions: Object.fromEntries(Object.entries(versions).sort()),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--public"))
    throw new Error(
      "Public receipts require explicit public-repository scope; private inventory stays internal",
    );
  const option = (key, fallback) => {
    const at = args.indexOf(key);
    return at < 0 ? fallback : args[at + 1];
  };
  const root = resolve(option("--root", "."));
  const dir = resolve(option("--dir", root));
  const output = resolve(
    option("--output", resolve(dir, "public/.well-known/fleet-release.json")),
  );
  const importer = relative(root, dir).replaceAll("\\", "/") || ".";
  if (importer.startsWith(".."))
    throw new Error("Project must be inside the checkout");
  // The checked-out tree is the source, not workflow_run's potentially different GITHUB_SHA.
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", root, "diff", "--quiet", "HEAD", "--"], {
    stdio: "pipe",
  });
  const untracked = execFileSync(
    "git",
    ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => resolve(root, path) !== output);
  if (untracked.length)
    throw new Error(
      "Untracked source prevents an exact-commit release receipt",
    );
  const manifest = JSON.parse(
    readFileSync(resolve(dir, "package.json"), "utf8"),
  );
  const pnpmPath = existsSync(resolve(dir, "pnpm-lock.yaml"))
    ? resolve(dir, "pnpm-lock.yaml")
    : resolve(root, "pnpm-lock.yaml");
  const npmPath = existsSync(resolve(dir, "package-lock.json"))
    ? resolve(dir, "package-lock.json")
    : resolve(root, "package-lock.json");
  const pnpmLock = existsSync(pnpmPath)
    ? readFileSync(pnpmPath, "utf8")
    : undefined;
  const npmLock =
    !pnpmLock && existsSync(npmPath)
      ? readFileSync(npmPath, "utf8")
      : undefined;
  const lockRoot = dirname(pnpmLock ? pnpmPath : npmPath);
  const lockImporter = relative(lockRoot, dir).replaceAll("\\", "/") || ".";
  const installed = {};
  const projects = (option("--projects", importer)).split(",");
  if (projects.some((project) => !isProjectPath(project)) || new Set(projects).size !== projects.length)
    throw new Error("Receipt importers must be unique project paths inside the checkout");
  const projectManifests = {};
  for (const project of projects) {
    projectManifests[project] = JSON.parse(readFileSync(resolve(root, project, "package.json"), "utf8"));
    for (const [name, spec] of Object.entries(dependencies(projectManifests[project]))) {
      if (!isShared(dependencyIdentity(name, spec))) continue;
      let location = resolve(root, project);
      while (true) {
        const path = resolve(location, "node_modules", name, "package.json");
        if (existsSync(path)) {
          installed[name] = JSON.parse(readFileSync(path, "utf8"));
          break;
        }
        if (location === root) break;
        const parent = dirname(location);
        if (parent === location || relative(root, parent).startsWith("..")) break;
        location = parent;
      }
    }
  }
  const receipt = createReleaseReceipt({
    repo: option("--repo"),
    commit,
    manifest,
    pnpmLock,
    npmLock,
    importer: lockImporter,
    importers: projects,
    manifests: projectManifests,
    installed,
  });
  // Project identity remains relative to the checkout, even for a nested independent lock root.
  receipt.project = importer;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    `Release receipt: ${commit.slice(0, 12)}, ${Object.keys(receipt.artifacts).length} shared artifacts`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
