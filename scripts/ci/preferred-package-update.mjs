const parse = value => /^\d+\.\d+\.\d+$/.test(value ?? '') ? value.split('.').map(Number) : null;
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** The target is a fresh published/CI-verified artifact, not the registry snapshot. */
export function preferredPackageUpdate({ repo, path, name, from, identity, currentVersion, target, sourceSha }) {
  const have = parse(currentVersion), want = parse(target?.version);
  if (!have || !want || compare(have, want) > 0) return null;
  let to;
  if (target.release?.source === 'git') {
    if (compare(have, want) === 0) return null;
    const sha = target.release.commit;
    const gitRepo = target.repo?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(gitRepo ?? '')) throw new Error('Unverified Git target');
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
