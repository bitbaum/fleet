import { latestVerifiedGitRelease } from "./git-package-currency.mjs";

const stable = (v) => /^\d+\.\d+\.\d+$/.test(v ?? "");
const compare = (a, b) => {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};

/** Recommend an actual release, never an unpublished repository manifest. */
export function releasedPackage(pkg, npmVersion, gitRelease) {
  const npm = stable(npmVersion) ? npmVersion : null;
  const git =
    stable(gitRelease?.version) && /^[0-9a-f]{40}$/.test(gitRelease?.sha ?? "")
      ? gitRelease
      : null;
  if (!npm && !git)
    throw new Error(
      `${pkg.name}: no stable published or verified Git artifact`,
    );
  if (git && (!npm || compare(git.version, npm) > 0)) {
    const repo = pkg.repo
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    return {
      ...pkg,
      version: git.version,
      install: { source: "git", command: `pnpm add github:${repo}#${git.sha}` },
      release: { source: "git", tag: git.tag, commit: git.sha },
    };
  }
  return {
    ...pkg,
    version: npm,
    install: { source: "npm", command: `pnpm add ${pkg.name}@^${npm}` },
    release: { source: "npm", version: npm },
  };
}

export async function releaseTargets(
  packages,
  fetchImpl = fetch,
  gitRelease = latestVerifiedGitRelease,
) {
  // Finish asynchronous registry reads before synchronous gh verification.
  // Otherwise gh can block the event loop past another fetch's deadline.
  const versions = await Promise.all(
    packages.map(async (pkg) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response;
        try {
          response = await fetchImpl(
            `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (response.status === 404) return null;
          if (response.ok)
            return (await response.json())?.["dist-tags"]?.latest;
        } catch (error) {
          if (attempt === 2)
            throw new Error(`${pkg.name}: npm release lookup unavailable`, {
              cause: error,
            });
          continue;
        }
        if (
          attempt === 2 ||
          (response.status !== 429 && response.status < 500)
        ) {
          throw new Error(
            `${pkg.name}: npm release lookup returned HTTP ${response.status}`,
          );
        }
      }
    }),
  );
  const targets = [];
  for (const [index, pkg] of packages.entries()) {
    const repo = pkg.repo
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    targets.push(releasedPackage(pkg, versions[index], await gitRelease(repo)));
  }
  return targets;
}
