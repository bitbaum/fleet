#!/usr/bin/env bash
#
# Negative tests for the duplication ratchet.
#
# The ratchet's whole value is that it can go RED. If it silently passes when
# duplication rises, it is worse than not having it — it certifies the thing it
# was built to stop, which is exactly how `continue-on-error` let evig ship 25
# failing tests under a green tick for three weeks.
#
# The counting half needs the GitHub API. The DECIDING half — compare current
# against baseline, and which way the ratchet turns — is pure text, so it is
# tested here against fixture files with no network at all. A rule only
# exercisable by a live API call is a rule nobody re-tests after editing it.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

# The ratchet comparison, extracted verbatim in behaviour from
# shared-inventory.sh so the fixtures exercise the real decision.
# (baseline, current) -> prints findings, returns 1 if duplication rose.
ratchet() {
  local baseline="$1" current="$2" fail=0
  while IFS=$'\t' read -r concern _ was_copies; do
    [ -n "$concern" ] || continue
    local now_line now_copies
    now_line=$(grep "^${concern}	" "$current" 2>/dev/null)
    [ -n "$now_line" ] || continue
    now_copies=$(printf '%s' "$now_line" | cut -f3)
    [ "$now_copies" -gt "$was_copies" ] && { echo "ROSE $concern $was_copies->$now_copies"; fail=1; }
  done < "$baseline"
  while IFS=$'\t' read -r concern _ now_copies; do
    [ -n "$concern" ] || continue
    cut -f1 "$baseline" | grep -qx "$concern" || { echo "NEW $concern $now_copies"; fail=1; }
  done < "$current"
  return $fail
}

printf 'ratchet\n'

printf 'rate-limit\t9\t14\nlogger\t6\t10\n' > "$TMP/base"

# ── it must go red ───────────────────────────────────────────────────────────
printf 'rate-limit\t9\t15\nlogger\t6\t10\n' > "$TMP/up"
if ratchet "$TMP/base" "$TMP/up" >/dev/null; then
  no 'a RISE in duplication is caught'
else
  ok 'a RISE in duplication is caught'
fi

printf 'rate-limit\t9\t14\nlogger\t6\t10\nnew-thing\t3\t3\n' > "$TMP/new"
if ratchet "$TMP/base" "$TMP/new" >/dev/null; then
  no 'a NEW unmeasured concern is caught'
else
  ok 'a NEW unmeasured concern is caught'
fi

# ── and it must stay quiet when it should ────────────────────────────────────
if ratchet "$TMP/base" "$TMP/base" >/dev/null; then
  ok 'an unchanged fleet passes'
else
  no 'an unchanged fleet passes'
fi

printf 'rate-limit\t9\t9\nlogger\t6\t10\n' > "$TMP/down"
if ratchet "$TMP/base" "$TMP/down" >/dev/null; then
  ok 'a DECREASE passes (progress is not a failure)'
else
  no 'a DECREASE passes (progress is not a failure)'
fi

# A concern dropped from the script must not be read as "rose to zero".
printf 'rate-limit\t9\t14\n' > "$TMP/dropped"
if ratchet "$TMP/base" "$TMP/dropped" >/dev/null; then
  ok 'a concern removed from the script does not fail the ratchet'
else
  no 'a concern removed from the script does not fail the ratchet'
fi

# ── the baseline in the repo must match the script's concerns ────────────────
printf 'baseline integrity\n'
BASE="$HERE/shared-inventory.baseline"
if [ -f "$BASE" ]; then
  bad=$(awk -F'\t' 'NF!=3 {print NR": "$0}' "$BASE")
  if [ -z "$bad" ]; then ok 'baseline rows are name<TAB>repos<TAB>files'; else no "malformed baseline rows: $bad"; fi

  missing=""
  while IFS=$'\t' read -r concern _ _; do
    [ -n "$concern" ] || continue
    grep -q "^${concern}|" "$HERE/shared-inventory.sh" || missing="$missing $concern"
  done < "$BASE"
  if [ -z "$missing" ]; then
    ok 'every baseline concern still exists in the script'
  else
    no "baseline names concerns the script no longer measures:$missing"
  fi
else
  no "no baseline committed at $BASE"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
