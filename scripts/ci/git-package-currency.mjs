import { execFileSync } from "node:child_process";

const rawPackageVersion = (repo, ref, run = execFileSync) => {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/package.json`;
  const content = run("curl", [
    "--fail", "--silent", "--show-error", "--location",
    "--retry", "3", "--retry-all-errors", "--retry-delay", "1", "--retry-max-time", "30",
    "--connect-timeout", "10", "--max-time", "30", url,
  ], {
    encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(content).version;
};

function gitTags(repo, run = execFileSync) {
  const output = run("git", ["ls-remote", "--tags", `https://github.com/${repo}.git`, "refs/tags/v*"], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tags = new Map();
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [sha, ref] = line.split("\t");
    const peeled = ref.endsWith("^{}");
    const tag = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    const entry = tags.get(tag) ?? { tag, sha: "" };
    entry[peeled ? "sha" : "objectSha"] = sha;
    if (!peeled && !entry.sha) entry.sha = sha; // lightweight tag
    tags.set(tag, entry);
  }
  return [...tags.values()];
}

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

const api = (path) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(execFileSync("gh", ["api", path], {
        encoding: "utf8", timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }));
    } catch (error) {
      if (attempt === 2 || !/HTTP (?:401|429|5\d\d)|timed out|ECONNRESET/.test(String(error.stderr ?? error.message))) throw error;
    }
  }
};
export function gitPackageVersion(repo, ref, request, run = execFileSync) {
  if (!request) return rawPackageVersion(repo, ref, run);
  const file = request(`repos/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`);
  return JSON.parse(Buffer.from(file.content, "base64").toString()).version;
}

/** Releases need a stable tag, matching package version and successful CI on that commit. */
export function latestVerifiedGitRelease(repo, request, run = execFileSync, readPackage = rawPackageVersion, checkRuns = api) {
  const refs = request
    ? request(`repos/${repo}/git/matching-refs/tags/v`)
    : gitTags(repo, run);
  const releases = refs
    .map((ref) => ({
      tag: ref.ref?.replace("refs/tags/", "") ?? ref.tag,
      version: (ref.ref?.replace("refs/tags/", "") ?? ref.tag)?.replace(/^v/, ""),
      sha: ref.sha,
    }))
    .filter((ref) => version(ref.version))
    .sort((a, b) => compare(version(b.version), version(a.version)));
  for (const release of releases) {
    const sha = request
      ? request(`repos/${repo}/commits/${encodeURIComponent(release.tag)}`).sha
      : release.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? "")) continue;
    const declaredVersion = request
      ? gitPackageVersion(repo, sha, request)
      : readPackage(repo, sha, run);
    if (declaredVersion !== release.version)
      continue;
    const runs = (request ?? checkRuns)(
      `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
    ).workflow_runs;
    const latest = runs.find(
      (run) =>
        run.path === ".github/workflows/ci.yml" &&
        ["push", "workflow_dispatch"].includes(run.event),
    );
    if (latest?.conclusion === "success")
      return { ...release, sha };
  }
  return null;
}
