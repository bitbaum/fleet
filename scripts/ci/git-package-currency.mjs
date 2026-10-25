import { execFileSync } from "node:child_process";

/** Only registered, immutable first-party Git artifacts belong to this updater. */
export function registeredGitDependency(specifier, registry) {
  if (typeof specifier !== "string") return null;
  const match =
    /^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?#(v\d+\.\d+\.\d+|[0-9a-f]{40})$/.exec(
      specifier,
    );
  if (!match) return null;
  const repo = match[1];
  const entry = registry.packages.find(
    (pkg) =>
      pkg.repo
        ?.replace(/^https:\/\/github\.com\//, "")
        .replace(/\.git$/, "") === repo,
  );
  return entry
    ? {
        repo,
        ref: match[2],
        name: entry.name,
        npm:
          entry.install?.source === "npm" || entry.name.startsWith("@bitbaum/"),
      }
    : null;
}

const version = (v) =>
  /^\d+\.\d+\.\d+$/.test(v ?? "") ? v.split(".").map(Number) : null;
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function planGitUpdate(repo, path, name, specifier, target) {
  if (!target || !/^[0-9a-f]{40}$/.test(target.sha ?? "")) return null;
  const have = version(target.currentVersion),
    want = version(target.version);
  // A newer untagged installation must never be downgraded to an older release tag.
  if (!have || !want || compare(have, want) >= 0) return null;
  return {
    repo,
    path,
    name,
    packageName: target.name,
    latest: target.version,
    from: specifier,
    to: specifier.replace(/#[^#]+$/, `#${target.sha}`),
    crossesMajor: have[0] !== want[0],
    stranded: have[0] === 0 && have[0] !== want[0],
    releaseTag: `v${target.version}`,
    source: "git",
  };
}

export function planRegistryMigration(
  repo,
  path,
  name,
  specifier,
  identity,
  currentVersion,
  latest,
) {
  const have = version(currentVersion),
    want = version(latest);
  if (!identity.npm || !have || !want || compare(have, want) > 0) return null;
  return {
    repo,
    path,
    name,
    packageName: identity.name,
    latest,
    from: specifier,
    to:
      name === identity.name ? `^${latest}` : `npm:${identity.name}@^${latest}`,
    crossesMajor: have[0] !== want[0],
    stranded: have[0] === 0 && have[0] !== want[0],
    source: "npm",
  };
}

const api = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
export function gitPackageVersion(repo, ref, request = api) {
  const file = request(
    `repos/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`,
  );
  const manifest = JSON.parse(Buffer.from(file.content, "base64").toString());
  return manifest.version;
}

/** Releases need a stable tag, matching package version and successful CI on that commit. */
export function latestVerifiedGitRelease(repo, request = api) {
  const refs = request(`repos/${repo}/git/matching-refs/tags/v`);
  const releases = refs
    .map((ref) => ({
      tag: ref.ref.replace("refs/tags/", ""),
      version: ref.ref.replace("refs/tags/v", ""),
    }))
    .filter((ref) => version(ref.version))
    .sort((a, b) => compare(version(b.version), version(a.version)));
  for (const release of releases) {
    const commit = request(
      `repos/${repo}/commits/${encodeURIComponent(release.tag)}`,
    );
    if (!/^[0-9a-f]{40}$/.test(commit.sha ?? "")) continue;
    if (gitPackageVersion(repo, commit.sha, request) !== release.version)
      continue;
    const runs = request(
      `repos/${repo}/actions/runs?head_sha=${commit.sha}&per_page=100`,
    ).workflow_runs;
    const latest = runs.find(
      (run) =>
        run.path === ".github/workflows/ci.yml" &&
        ["push", "workflow_dispatch"].includes(run.event),
    );
    if (latest?.conclusion === "success")
      return { ...release, sha: commit.sha };
  }
  return null;
}
