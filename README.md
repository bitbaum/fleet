# fleet

The fleet's central automation: the checks that run **from this repo against
every other repo**, the golden CI templates, and the shared-package registry.
One copy of each, so nothing can drift.

Moved out of `dotfiles` on 2026-08-28 — a repo holding someone's `.bashrc` is
the wrong place for the machinery that gates thirty other repos, and keeping
them together made every fleet change look like an environment change and vice
versa. `dotfiles` is the environment again; this repo is the automation.

| | |
|---|---|
| [`SHARED.md`](SHARED.md) | the shared-package registry and the duplication ratchet — **read before building anything cross-cutting** |
| [`STACK.md`](STACK.md) | the blessed technology per job — ONE ORM, ONE test runner, ONE auth stack; deviations are documented exceptions, not habits |
| [`registers/readings.json`](registers/readings.json) | derived nightly: the numbers the bet rests on — stars, forks, npm downloads, paying clients and CHF/month, originator share paid — as a time series that gains a row only when a reading changes. Zero is a reading. |
| [`registers/origin.json`](registers/origin.json) | derived nightly: for every public repo, GitHub's first commit, the OpenTimestamps manifest and Bitcoin block it is proven in, and its Software Heritage snapshot. What bitbaum.orangecat.ch says about origin comes from here. |
| [`registers/org.json`](registers/org.json) | machine-readable register of org facts — agents read this, not READMEs. A new claim is a register row or it does not ship. |
| `scripts/ci/auto-merge-sweep.sh` | the canonical merge policy; the fleet calls it via the reusable workflow below. Includes the contributor gate: an outside PR merges only when every commit is `Signed-off-by`, certifying [`bitbaum/.github/CONTRIBUTING.md`](https://github.com/bitbaum/.github/blob/main/CONTRIBUTING.md) — the DCO plus the licence grant that keeps relicensing possible |
| `scripts/ci/model-pin-audit.mjs` | runs daily: is any model id the fleet pins still served by its vendor? |
| `scripts/ci/verify-floor-audit.sh` | does every repo's `verify` actually run lint + typecheck + test? |
| `scripts/ci/shared-inventory.sh` | counts duplication across the fleet and holds it as a ratchet |
| `scripts/ci/org-drift-audit.sh` | does any public document contradict the org register? A ratchet that prevents new lies from landing. |
| `scripts/ci/cicd-hygiene-audit.sh` | is the pipeline AROUND the gates sound — no self-cancelling deploys, no deploy re-running CI's bundle, no cold Next builds? |
| `scripts/ci/version-currency.mjs` | measures every repo against `blessed-versions.json` (SSOT of blessed majors + internal-package tags) and holds the gap count as a ratchet |
| `scripts/ci/ui-defect-audit.mjs` | do any live sites ship WCAG AA contrast failures or misaligned stacks? |
| [`scripts/ci/origin-proof.sh`](scripts/ci/origin-proof.sh) | runs nightly: stamps every repo's HEAD through OpenTimestamps and asks Software Heritage to snapshot it — third-party proof of WHEN the code existed, since git dates prove nothing. Proofs live in [`proofs/origin/`](proofs/origin/). |
| [`scripts/ci/bus-factor-audit.sh`](scripts/ci/bus-factor-audit.sh) | runs weekly: could someone who is not Cato operate each live app? Are its secrets NAMED in a committed env example (ratchet), and with `--box`: can it roll back, is its database dump fresh, do dumps leave the disk |
| `scripts/ci/nextauth-origin-audit.mjs` | runs daily: does every next-auth app advertise its own public origin, or is it publishing `localhost` from behind Caddy? |
| `scripts/fleet/` | local upkeep: worktree GC, stranded-work guard |
| `templates/ci/` | golden CI workflows + pre-commit — deliberately ONE central copy |
| [`templates/CONTRIBUTING.md`](templates/CONTRIBUTING.md) | a pointer only: the terms live in `bitbaum/.github`, which GitHub shows on every repo's PR form. Do not copy them into a repo |

## The reusable auto-merge sweep

Repos adopt it with ~10 lines:

```yaml
jobs:
  sweep:
    uses: bitbaum/fleet/.github/workflows/auto-merge-sweep.yml@main
    secrets:
      token: ${{ secrets.GITHUB_TOKEN }}
```

All sixteen callers point here directly. The forwarding shim that briefly
lived in `bitbaum/dotfiles` was removed once the last one migrated — a shim
that forwards nothing is just a second place the sweep appears to live, and
drift between copies is the problem this repo exists to end.

## Org drift prevention

Agents read the register and apps.conf. They do not restate the org story. A
new claim is a register row or it does not ship.

The register (`registers/org.json`) holds facts that have no other producer:
public name, legal status, house domain, host, design system. The drift audit
(`scripts/ci/org-drift-audit.sh`) fails when a public document contradicts it.
Existing violations are baselined; new ones cannot land. The inventory is
generated, and the number is a ratchet.

Live doors come from `bitbaum/loki:scripts/hetzner/apps.conf`, the SSOT
manifest for self-hosted apps. A README claiming a door that disagrees with
apps.conf is a drift violation.

## Rules of the house

- Every audit has a test suite beside it (`test-*.sh`, `test-*.mjs`). Keep it
  that way — these gate every repo, so a broken checker is a fleet-wide outage.
- The duplication ratchet (`scripts/ci/shared-inventory.sh --check`) runs
  weekly, not per PR — a PR runs its network-free self-test. Counts may fall,
  may hold, and may never rise.
