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
/** Only public first-party package metadata; no environment, paths, or product data. */
export function createReleaseReceipt({
  repo,
  commit,
  manifest,
  pnpmLock,
  npmLock,
  importer = ".",
  installed = {},
  createdAt = new Date().toISOString(),
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") ||
    !/^[0-9a-f]{40}$/.test(commit ?? "")
  )
    throw new Error("A repository and exact built commit are required");
  if (importer.includes("..") || /[\n\r\\]/.test(importer))
    throw new Error("Project must be inside the checkout");
  const wanted = Object.entries(dependencies(manifest)).filter(([name, spec]) =>
    isShared(dependencyIdentity(name, spec)),
  );
  if (wanted.length && !pnpmLock && !npmLock)
    throw new Error("Shared packages require a supported lockfile");
  const locked = pnpmLock
    ? lockedDependencies(manifest, pnpmLock, importer)
    : npmLock
      ? lockedNpmDependencies(manifest, JSON.parse(npmLock), importer)
      : {};
  const artifacts = {},
    versions = {};
  for (const [depName, spec] of wanted) {
    const name = dependencyIdentity(depName, spec),
      artifact = locked[name],
      actual = installed[depName];
    if (!isImmutableArtifact(artifact ?? ""))
      throw new Error(`${name}: immutable locked artifact required`);
    if (!actual?.version || !isPackageVersion(actual.version))
      throw new Error(`${name}: installed package metadata is missing`);
    if (/^\d/.test(artifact) && artifact !== actual.version)
      throw new Error(`${name}: installed package differs from the lockfile`);
    artifacts[name] = artifact;
    versions[name] = actual.version;
  }
  return {
    formatVersion: 1,
    repo,
    commit,
    project: importer,
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
  for (const [name, spec] of Object.entries(dependencies(manifest))) {
    if (!isShared(dependencyIdentity(name, spec))) continue;
    let location = dir;
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
  const receipt = createReleaseReceipt({
    repo: option("--repo"),
    commit,
    manifest,
    pnpmLock,
    npmLock,
    importer: lockImporter,
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
