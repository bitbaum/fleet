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
| `scripts/ci/auto-merge-sweep.sh` | the canonical merge policy; the fleet calls it via the reusable workflow below |
| `scripts/ci/model-pin-audit.mjs` | runs daily: is any model id the fleet pins still served by its vendor? |
| `scripts/ci/verify-floor-audit.sh` | does every repo's `verify` actually run lint + typecheck + test? |
| `scripts/ci/shared-inventory.sh` | counts duplication across the fleet and holds it as a ratchet |
| `scripts/ci/ui-defect-audit.mjs` | do any live sites ship WCAG AA contrast failures or misaligned stacks? |
| `scripts/fleet/` | local upkeep: worktree GC, stranded-work guard |
| `templates/ci/` | golden CI workflows + pre-commit — deliberately ONE central copy |

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

## Rules of the house

- Every audit has a test suite beside it (`test-*.sh`, `test-*.mjs`). Keep it
  that way — these gate every repo, so a broken checker is a fleet-wide outage.
- The duplication ratchet (`scripts/ci/shared-inventory.sh --check`) runs on
  every PR here: counts may fall, may hold, and may never rise.
