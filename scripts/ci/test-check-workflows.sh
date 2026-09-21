#!/usr/bin/env bash
# Self-test for check-workflows.sh. No network, no checkout.
#
# The first fixture is the real defect, reproduced exactly: a flush-left
# heredoc inside a `run: |` block, which is how `internal-currency.yml` merged
# to main unparseable on 2026-09-21. If that case ever goes green again, this
# check is decorative.
#
#   bash scripts/ci/test-check-workflows.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gate="$here/check-workflows.sh"

failures=0
pass() { echo "  ok   $1"; }
fail() {
  echo "  FAIL $1 — $2"
  failures=$((failures + 1))
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Callers read as (what this case is, which directory) — so the gate runs
# against $2 and the label is $1. Reversed, every case silently ran the gate
# against its own description, which is a directory that does not exist: the
# red half "passed" for the wrong reason and the green half failed. Caught by
# running it.
expect_red() {
  if bash "$gate" "$2" >/dev/null 2>&1; then
    fail "$1" "gate stayed GREEN"
  else
    pass "$1"
  fi
}

expect_green() {
  local out
  if out="$(bash "$gate" "$2" 2>&1)"; then
    pass "$1"
  else
    fail "$1" "gate went RED: $out"
  fi
}

echo "check-workflows self-test"
echo
echo "  — must go red —"

# 1. THE REAL DEFECT. A heredoc at column 0 ends the block scalar, and the file
#    stops being parseable from that point on.
d="$work/flush_heredoc"
mkdir -p "$d"
cat >"$d/broken.yml" <<'YAML'
name: Broken
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - run: |
          git commit -m "a title

Body flush left, which ends the YAML block scalar right here.
"
          echo after
YAML
expect_red "a flush-left heredoc inside a run: block" "$d"

# 2. Parses, but hands the runner something bash cannot run. yaml.safe_load
#    alone would call this file fine.
d="$work/bad_shell"
mkdir -p "$d"
cat >"$d/badshell.yml" <<'YAML'
name: Bad shell
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - run: |
          if [ -z "$X" ]; then
            echo missing
YAML
expect_red "valid YAML whose run: block is not valid shell" "$d"

d="$work/unterminated"
mkdir -p "$d"
cat >"$d/heredoc.yml" <<'YAML'
name: Unterminated
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - run: |
          cat <<'EOT'
          never closed
YAML
expect_red "an unterminated heredoc" "$d"

# 3. The two keys without which a workflow silently never fires. A missing
#    name is the exact tell GitHub gave: the path shown where the name goes.
d="$work/no_on"
mkdir -p "$d"
cat >"$d/noon.yml" <<'YAML'
name: No trigger
jobs:
  go:
    steps:
      - run: echo hi
YAML
expect_red "no \`on:\` — it can never be triggered" "$d"

d="$work/no_name"
mkdir -p "$d"
cat >"$d/noname.yml" <<'YAML'
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - run: echo hi
YAML
expect_red "no \`name:\`" "$d"

echo
echo "  — must stay quiet —"

# 4. The corrected shape: an INDENTED heredoc. YAML strips the block's common
#    indentation, so the body and terminator reach bash at column 0.
d="$work/indented_heredoc"
mkdir -p "$d"
cat >"$d/good.yml" <<'YAML'
name: Good
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - run: |
          cat >/tmp/msg.txt <<'MSG'
          a title

          a body, indented in the file and flush-left by the time bash sees it
          MSG
          git commit -F /tmp/msg.txt
YAML
expect_green "an indented heredoc" "$d"

# 5. Steps with no `run:` at all must not be mistaken for empty scripts.
d="$work/uses_only"
mkdir -p "$d"
cat >"$d/uses.yml" <<'YAML'
name: Uses only
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
YAML
expect_green "a workflow of only \`uses:\` steps" "$d"

# 6. `${{ }}` is not shell and must not be parsed as it. A step full of
#    expressions is ordinary and must never be flagged.
d="$work/expressions"
mkdir -p "$d"
cat >"$d/expr.yml" <<'YAML'
name: Expressions
on:
  workflow_dispatch:
jobs:
  go:
    steps:
      - env:
          B: ${{ toJSON(matrix.target.bumps) }}
        run: |
          echo "${{ github.sha }}"
          echo "$B" | head -1
YAML
expect_green "GitHub expressions inside a run: block" "$d"

echo
echo "  — the floor —"

d="$work/empty"
mkdir -p "$d"
expect_red "a directory with no workflows at all" "$d"

echo
echo "  — the real thing —"

if [ -d "$here/../../.github/workflows" ]; then
  expect_green "this repo's own workflows" "$here/../../.github/workflows"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) FAILED" >&2
  exit 1
fi
echo "all checks passed"
