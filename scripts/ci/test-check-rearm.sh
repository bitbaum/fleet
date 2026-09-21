#!/usr/bin/env bash
# Self-test for check-rearm.sh. No network, no checkout.
#
# This gate was narrowed on 2026-09-21 after it produced its first false
# positive, and a narrowing is exactly the change that must be pinned from both
# sides. A gate loosened until it stops complaining and a gate that cries wolf
# end in the same place — disabled — so every case below is either "must still
# go red" or "must stay quiet", and the red half is written first on purpose.
#
#   bash scripts/ci/test-check-rearm.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gate="$here/check-rearm.sh"

failures=0
pass() { echo "  ok   $1"; }
fail()  { echo "  FAIL $1 — $2"; failures=$((failures + 1)); }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A workflow that pushes to main AND re-arms correctly. Present in every
# fixture directory so the "matched nothing" floor is satisfied and each case
# tests one thing.
good_main() {
  cat <<'YAML'
name: Readings
permissions:
  contents: write
  actions: write
jobs:
  go:
    steps:
      - run: |
          git commit -m x
          git push
      - run: gh workflow run ci.yml --ref main
YAML
}

case_dir() {
  local d="$work/$1"
  mkdir -p "$d"
  good_main >"$d/readings.yml"
  echo "$d"
}

expect_red() {
  local name="$1" dir="$2"
  if bash "$gate" "$dir" >/dev/null 2>&1; then
    fail "$name" "gate stayed GREEN on a workflow that can strand the queue"
  else
    pass "$name"
  fi
}

expect_green() {
  local name="$1" dir="$2" out
  if out="$(bash "$gate" "$dir" 2>&1)"; then
    pass "$name"
  else
    fail "$name" "gate went RED: $out"
  fi
}

echo "check-rearm self-test"
echo
echo "  — must still go red —"

# 1. The original case, unchanged: a bare push with no re-arm.
d="$(case_dir bare_no_rearm)"
cat >"$d/offender.yml" <<'YAML'
name: Origin proof
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push
YAML
expect_red "a bare \`git push\` with no re-arm" "$d"

# 2. Re-arms, but cannot: the dispatch is refused without actions: write.
d="$(case_dir rearm_no_perm)"
cat >"$d/offender.yml" <<'YAML'
name: Shared inventory
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push
      - run: gh workflow run ci.yml --ref main
YAML
expect_red "a re-arm without \`actions: write\`" "$d"

# 3. Written out explicitly rather than bare. Same invariant, and the shape a
#    narrowing is most likely to let slip.
d="$(case_dir explicit_main)"
cat >"$d/offender.yml" <<'YAML'
name: Explicit
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push origin main
YAML
expect_red "an explicit \`git push origin main\`" "$d"

d="$(case_dir head_main)"
cat >"$d/offender.yml" <<'YAML'
name: Head main
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push origin HEAD:main
YAML
expect_red "\`HEAD:main\`" "$d"

d="$(case_dir force_main)"
cat >"$d/offender.yml" <<'YAML'
name: Forced
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push --force-with-lease origin main
YAML
expect_red "flags do not hide the target" "$d"

# 4. THE DOORWAY. Naming your target `$BRANCH` must not buy an exemption when
#    the file sets BRANCH to main ten lines above. Without this, the narrowing
#    would be a hole rather than a fix.
d="$(case_dir var_is_main)"
cat >"$d/offender.yml" <<'YAML'
name: Sneaky
permissions:
  contents: write
jobs:
  go:
    env:
      BRANCH: main
    steps:
      - run: git push origin "$BRANCH"
YAML
expect_red "a variable target that IS main" "$d"

d="$(case_dir var_is_main_sh)"
cat >"$d/offender.yml" <<'YAML'
name: Sneaky shell
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: |
          BRANCH=main
          git push origin "$BRANCH"
YAML
expect_red "a shell-assigned variable that IS main" "$d"

echo
echo "  — must stay quiet —"

# 5. The case that motivated the narrowing: a feature branch, in another repo.
d="$(case_dir feature_branch)"
cat >"$d/internal-currency.yml" <<'YAML'
name: Internal package currency
permissions:
  contents: read
jobs:
  bump:
    steps:
      - uses: actions/checkout@v7
        with:
          repository: bitbaum/other
          token: ${{ secrets.FLEET_PAT }}
      - env:
          BRANCH: fleet/internal-currency
        run: |
          git checkout -B "$BRANCH"
          git push --force-with-lease origin "$BRANCH"
YAML
expect_green "a feature branch pushed to another repo" "$d"

# 6. A literal non-main branch.
d="$(case_dir literal_branch)"
cat >"$d/offender.yml" <<'YAML'
name: Literal
permissions:
  contents: write
jobs:
  go:
    steps:
      - run: git push origin some/feature-branch
YAML
expect_green "a literal non-main branch" "$d"

# 7. A comment is not a push. Without this the gate reported ITSELF: ci.yml
#    quotes the predicate in the comment explaining it.
d="$(case_dir only_comments)"
cat >"$d/talker.yml" <<'YAML'
name: Talks about pushing
jobs:
  go:
    # this job used to `git push` and no longer does
    steps:
      - run: |
          # git push origin main   <- removed, left for history
          echo nothing
YAML
expect_green "a workflow that only MENTIONS git push, in comments" "$d"

# 8. The correct main-pusher alone. If this ever goes red, the gate is
#    unsatisfiable and will be deleted by whoever hits it next.
d="$(case_dir only_good)"
expect_green "a correct main-pusher with re-arm and permission" "$d"

echo
echo "  — the floor —"

# 9. A predicate that matches nothing passes as quietly as one that works. If
#    every main-pusher disappears, that is a finding, not a clean run.
d="$work/no_pushers"
mkdir -p "$d"
cat >"$d/quiet.yml" <<'YAML'
name: Quiet
jobs:
  go:
    steps:
      - run: echo nothing to see
YAML
expect_red "a directory with no main-pushing workflow at all" "$d"

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) FAILED" >&2
  exit 1
fi
echo "all checks passed"
