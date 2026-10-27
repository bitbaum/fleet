/** Avoid cross-canary cycles: land a representative's own artifacts first. */
export function canaryFirst(plan, policy, owner = "bitbaum") {
  return plan.map((entry) => {
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
    if (!first.length) return entry;
    const deferred = entry.bumps.filter((bump) => !owned.has(bump.packageName ?? bump.name));
    return deferred.length ? { ...entry, bumps: first, deferredBumps: deferred } : entry;
  });
}
