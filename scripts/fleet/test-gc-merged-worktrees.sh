#!/usr/bin/env bash
#
# Tests for the worktree GC predicate.
#
# This script deletes checkouts, so the only interesting failure mode is a FALSE
# POSITIVE: removing something that was not safe. Every refusal below is a case
# that would have destroyed work, so each is tested individually rather than
# through one combined "unsafe" fixture — a single guard silently inverting is
# exactly what a combined test hides.
#
# The predicate is pure by design so all of this runs without a GitHub repo, a
# network call, or a live agent session.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/gc-merged-worktrees.sh"

PASS=0
FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

export GC_WORKTREES_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT" ""
unset GC_WORKTREES_LIB_ONLY

# safe_to_remove <pushed> <dirty_n> <in_use> <pr_state>
say() { safe_to_remove "$@"; }

echo "the one case that may be removed:"

out="$(say yes 0 no MERGED)"; rc=$?
[ $rc -eq 0 ] && [ "$out" = ok ] \
  && ok "pushed + clean + unused + MERGED is removable" \
  || no "the happy path must return ok (rc=$rc, out='$out')"

echo
echo "every refusal — each of these would have destroyed work:"

# The one that matters most. A branch with no upstream exists on exactly one
# disk; this is the case the whole guard exists to protect.
out="$(say no 0 no MERGED)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"only copy"* ]] \
  && ok "never-pushed is refused even when everything else looks fine" \
  || no "unpushed work must never be removable (rc=$rc, out='$out')"

out="$(say yes 1 no MERGED)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"uncommitted"* ]] \
  && ok "a single uncommitted file is enough to refuse" \
  || no "dirty worktrees must be refused (rc=$rc, out='$out')"

out="$(say yes 0 yes MERGED)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"live session"* ]] \
  && ok "a worktree with a live session in it is refused" \
  || no "in-use worktrees must be refused (rc=$rc, out='$out')"

# CLOSED is not MERGED. An abandoned PR is still a decision someone may want to
# revisit, and the branch content exists nowhere else once the remote is gone.
out="$(say yes 0 no CLOSED)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"CLOSED"* ]] \
  && ok "a CLOSED (abandoned) PR is refused — closed is not merged" \
  || no "CLOSED must be refused (rc=$rc, out='$out')"

out="$(say yes 0 no OPEN)"; rc=$?
[ $rc -ne 0 ] \
  && ok "an OPEN PR is refused" \
  || no "OPEN must be refused (rc=$rc, out='$out')"

# `gh` returning nothing is ambiguous — no PR, no auth, rate limit, network
# down. Ambiguity must resolve to "keep", never to "delete".
out="$(say yes 0 no "")"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"none"* ]] \
  && ok "an empty gh answer keeps the worktree — ambiguity is not consent" \
  || no "empty PR state must be refused (rc=$rc, out='$out')"

echo
echo "the script itself:"

out="$(bash "$SCRIPT" --nonsense 2>&1)"; rc=$?
[ $rc -eq 2 ] \
  && ok "an unknown argument fails loudly rather than defaulting to --go" \
  || no "unknown args must exit 2 (rc=$rc)"

# Default must be dry-run. If this ever inverts, the first person to run the
# script with no arguments loses 5 GB of checkouts.
out="$(FLEET_ROOT="$(mktemp -d)" bash "$SCRIPT" 2>&1)"; rc=$?
[[ "$out" == *"rerun with --go"* ]] \
  && ok "no arguments means dry-run, and says so" \
  || no "the default must be dry-run (out='$out')"

echo
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
