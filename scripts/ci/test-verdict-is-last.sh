#!/usr/bin/env bash
# A test script's verdict must be its LAST command.
#
# A bash script's exit status is its last command's. test-auto-merge-sweep.sh
# ended its tests with `[ "$FAIL" -eq 0 ]` at line 400 — and then ~70 lines of
# tests were appended after it. The verdict was discarded: the suite exited 0
# while printing "27 passed, 1 failed", its later tests were not even counted,
# and a stale assertion (test 13, overtaken by the sweep's deadlock fix) sat
# red-but-green on main unseen.
#
# This checks the shape, not the arithmetic: any bare `[ "$FAIL" -eq 0 ]`-style
# verdict under scripts/ must be the final non-comment line of its file.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; fail=0
ok() { pass=$((pass + 1)); echo "  ✓ $1"; }
no() { fail=$((fail + 1)); echo "  ✗ $1"; }

VERDICT='^[[:space:]]*\[[[:space:]]*"?\$\{?(FAIL|fail|failures|FAILURES)\}?"?[[:space:]]+-eq[[:space:]]+0[[:space:]]*\][[:space:]]*$'

# last non-blank, non-comment line number of a file
last_code_line() { awk '!/^[[:space:]]*(#|$)/ { n = NR } END { print n + 0 }' "$1"; }

echo "verdict-is-last"

# Self-test: the check must bite on the exact shape that shipped.
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
printf '%s\n' 'FAIL=0' '[ "$FAIL" -eq 0 ]' 'echo "a test appended after the verdict"' > "$tmp"
v="$(grep -nE "$VERDICT" "$tmp" | cut -d: -f1)"
[ -n "$v" ] && [ "$v" != "$(last_code_line "$tmp")" ] \
  && ok "detector flags a verdict with code after it" \
  || no "detector is blind to a verdict with code after it"

bad=""
while IFS= read -r f; do
  last="$(last_code_line "$f")"
  while IFS= read -r ln; do
    [ -n "$ln" ] && [ "$ln" != "$last" ] && bad="${bad}${f}:${ln} (last code line is ${last})"$'\n'
  done < <(grep -nE "$VERDICT" "$f" | cut -d: -f1)
done < <(find scripts -name '*.sh' -not -path '*/node_modules/*' | sort)

if [ -z "$bad" ]; then
  ok "every test-suite verdict under scripts/ is its file's last command"
else
  no "a verdict is not the last command, so its result is DISCARDED and the suite exits 0 on failure:"
  printf '      %s\n' $bad
fi

echo "verdict-is-last: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
