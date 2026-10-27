const projectPath = value => typeof value === "string" && value.length > 0 &&
  !value.startsWith("/") && !/[\\\r\n]/.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== "..");

/** Only explicitly governed mirrors are excluded; provenance alone is not ownership. */
export function managedMirrorFor(repo, path, policy) {
  for (const mirror of policy.managedConsumerMirrors?.[repo] ?? []) {
    if (!projectPath(mirror.path) || !projectPath(mirror.ownerPath) ||
        !/^bitbaum\/[\w.-]+$/.test(mirror.ownerRepo ?? "") ||
        !/^[\w.-]+\.ya?ml$/.test(mirror.syncWorkflow ?? ""))
      throw new Error(`${repo}: invalid managed mirror policy`);
    if (path.startsWith(`${mirror.path}/`)) return mirror;
  }
  return null;
}

/** A missing provenance pin or sync path is broken ownership, never a quiet skip. */
export function verifyMirrorEvidence(mirror, read) {
  if (!/^[0-9a-f]{40}$/.test(read(`${mirror.path}/.fleet-source`).trim()))
    throw new Error(`${mirror.path}: managed mirror lacks an immutable source pin`);
  if (!read(`.github/workflows/${mirror.syncWorkflow}`).trim())
    throw new Error(`${mirror.path}: managed mirror lacks its synchronization workflow`);
}
