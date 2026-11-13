const parse = value => /^\d+\.\d+\.\d+$/.test(value ?? '') ? value.split('.').map(Number) : null;
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** An npm range raised to `version`, keeping the operator and any alias. */
function npmUpdate({ repo, path, name, from, identity, have, version, sourceSha }) {
  const want = parse(version);
  const oldRange = identity.range;
  const op = typeof oldRange === 'string' ? oldRange.match(/^[~^]/)?.[0] ?? '' : '^';
  const to = name === identity.packageName ? `${op}${version}` : `npm:${identity.packageName}@${op}${version}`;
  if (from === to) return null;
  const floor = parse(identity.range?.replace(/^[~^]/, ''));
  if (floor && compare(floor, want) > 0) return null;
  return { repo, path, name, packageName: identity.packageName, from, to,
    latest: version, source: 'npm', sourceSha,
    crossesMajor: have[0] !== want[0], stranded: have[0] === 0 && have[0] !== want[0] };
}

/** The target is a fresh published/CI-verified artifact, not the registry snapshot. */
export function preferredPackageUpdate({ repo, path, name, from, identity, currentVersion, target, sourceSha }) {
  const have = parse(currentVersion), want = parse(target?.version);
  if (!have || !want || compare(have, want) > 0) return null;
  const sameVersion = compare(have, want) === 0;
  let to;
  if (target.release?.source === 'git') {
    const sha = target.release.commit;
    const gitRepo = target.repo?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(gitRepo ?? '')) throw new Error('Unverified Git target');
    const installedGit = /^(?:github:|git\+https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?#(v\d+\.\d+\.\d+|[0-9a-f]{40})$/.exec(from ?? '');
    if (sameVersion && (!installedGit || installedGit[1] !== gitRepo || installedGit[2] === sha)) return null;
    if (!installedGit && target.npmVersion) {
      // A consumer that installs from npm stays on npm while the package is
      // published there. (A package with no npm release at all is still
      // adopted from its verified Git release.) A Git release leads
      // the npm publish by minutes or days; moving `^0.6.1` to
      // `github:bitbaum/bip-kit#<sha>` in that window made the install build
      // the package from source, which pnpm refuses unless the app allows it
      // (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED), and the whole bump failed for
      // eight repositories on 2026-11-13. It takes the newest npm version
      // instead, or waits for the publish.
      const npm = parse(target.npmVersion);
      if (!npm || compare(have, npm) >= 0) return null;
      return npmUpdate({ repo, path, name, from, identity, have, version: target.npmVersion, sourceSha });
    }
    to = `github:${gitRepo}#${sha}`;
  } else if (target.release?.source === 'npm') {
    // Preserve the dependency key, including aliases; a Git alias may differ.
    const oldRange = identity.range;
    const op = typeof oldRange === 'string' ? oldRange.match(/^[~^]/)?.[0] ?? '' : '^';
    to = name === identity.packageName ? `${op}${target.version}` : `npm:${identity.packageName}@${op}${target.version}`;
  } else throw new Error('Missing released target');
  if (from === to) return null;
  // Raising a manifest floor must not lower an explicitly newer commitment.
  const floor = parse(identity.range?.replace(/^[~^]/, ''));
  if (floor && compare(floor, want) > 0) return null;
  return { repo, path, name, packageName: identity.packageName, from, to,
    latest: target.version, source: target.release.source, sourceSha,
    crossesMajor: have[0] !== want[0], stranded: have[0] === 0 && have[0] !== want[0] };
}

export function immutableGitArtifact(artifact) {
  const codeload = /^https:\/\/codeload\.github\.com\/([\w.-]+\/[\w.-]+)\/tar\.gz\/([0-9a-f]{40})$/.exec(artifact ?? '');
  const git = /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?#([0-9a-f]{40})$/.exec(artifact ?? '');
  const match = codeload ?? git;
  return match ? { repo: match[1], sha: match[2] } : null;
}
