export const isPackageVersion = (value) =>
  typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(value);
export const isImmutableArtifact = (value) =>
  isPackageVersion(value) ||
  (typeof value === "string" &&
    (/^https:\/\/codeload\.github\.com\/bitbaum\/[\w.-]+\/tar\.gz\/[0-9a-f]{40}$/.test(
      value,
    ) ||
      /^git\+https:\/\/github\.com\/bitbaum\/[\w.-]+(?:\.git)?#[0-9a-f]{40}$/.test(
        value,
      )));

/** Expected artifacts are the caller's complete canonical first-party map. */
export function receiptMatches(
  receipt,
  { repo, commit, artifacts, lockSha256, project = ".", projects },
) {
  if (
    receipt?.formatVersion !== 1 ||
    receipt.repo !== repo ||
    receipt.commit !== commit ||
    receipt.project !== project
  )
    return false;
  if (
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    !/^[0-9a-f]{64}$/.test(receipt.lockSha256 ?? "")
  )
    return false;
  if (lockSha256 && receipt.lockSha256 !== lockSha256) return false;
  if (projects && JSON.stringify(receipt.projects) !== JSON.stringify(projects)) return false;
  const actual = Object.entries(receipt.artifacts ?? {}).sort();
  if (
    actual.some(
      ([name, artifact]) =>
        !isImmutableArtifact(artifact) ||
        !isPackageVersion(receipt.versions?.[name]) ||
        (isPackageVersion(artifact) && receipt.versions[name] !== artifact),
    )
  )
    return false;
  return (
    JSON.stringify(actual) === JSON.stringify(Object.entries(artifacts).sort())
  );
}
