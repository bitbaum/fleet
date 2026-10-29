/** Avoid cross-canary cycles: land a representative's own artifacts first. */
export function canaryFirst(plan, policy, owner = "bitbaum") {
  const representatives = [];
  const consumers = [];
  for (const entry of plan) {
    const repo = entry.repo.includes("/") ? entry.repo : `${owner}/${entry.repo}`;
    const owned = new Set(
      Object.entries(policy.packages ?? {})
        .filter(([, config]) =>
          [config, ...(config.additionalCanaries ?? [])].some(
            (representative) => representative.canary === repo,
          ),
        )
        .map(([name]) => name),
    );
    const first = entry.bumps.filter((bump) => owned.has(bump.packageName ?? bump.name));
    if (!first.length) {
      consumers.push(entry);
      continue;
    }
    const deferred = entry.bumps.filter((bump) => !owned.has(bump.packageName ?? bump.name));
    representatives.push(
      deferred.length ? { ...entry, bumps: first, deferredBumps: deferred } : entry,
    );
  }
  // The workflow has one update job at a time. Put the consumers that unblock
  // admission first, retaining the input order within each group.
  return [...representatives, ...consumers];
}
