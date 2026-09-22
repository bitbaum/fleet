#!/usr/bin/env bash
# The sweep must not wait forever for a CI run that nothing will ever produce.
#
# An automated merge is made with GITHUB_TOKEN, which emits no workflow events,
# so it lands on the base branch and produces NO CI run. The green-base guard
# then asks "is there a CI run for the tip?", finds none, falls through to the
# newest run of all — some older commit — and defers. Every sweep. Forever.
# The re-arm that would fix it is gated on `merged_any`, downstream of the very
# block that prevents any merge.
#
# Measured on bitbaum/loki 2026-09-22: base CI history stopped on 09-13, every
# sweep since exited in ~7s reporting success, and four non-draft green PRs sat
# unmerged for up to fifteen days.
#
# These tests drive the real script with a stubbed `gh`. The script is written
# to tolerate that ("a lone object is tolerated so a stubbed gh still works").
#
# Run: bash scripts/test/auto-merge-sweep-no-base-ci.sh
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SWEEP="$HERE/../ci/auto-merge-sweep.sh"
[ -f "$SWEEP" ] || { echo "cannot find auto-merge-sweep.sh at $SWEEP"; exit 1; }

failures=0
pass() { echo "  ✓ $1"; }
fail() { failures=$((failures + 1)); echo "  ✗ $1"; echo "    $2"; }

# Run the sweep with a stubbed gh. $1 = base sha, $2 = `gh run list` JSON.
#
# Echoes the sweep's combined output, so callers use $(run_sweep …) — which
# runs it in a SUBSHELL. Dispatches therefore have to travel back through a
# file the parent owns ($DISPATCH_LOG, reset by the caller); an assignment made
# in here would be discarded, and the test would report "nothing dispatched"
# for a sweep that dispatched perfectly well.
run_sweep() {
  local base_sha="$1" runs_json="$2"
  local tmp
  tmp=$(mktemp -d)

  cat > "$tmp/gh" <<'STUB'
#!/usr/bin/env bash
sub="${1:-}"; shift || true
case "$sub" in
  api)
    case "${1:-}" in
      */commits/*) printf '%s' "$STUB_BASE_SHA" ;;
      *) printf '' ;;
    esac
    ;;
  run)
    if [ "${1:-}" = "list" ]; then printf '%s' "$STUB_RUNS_JSON"; else printf '' ; fi
    ;;
  workflow)
    echo "DISPATCH $*" >> "$STUB_DISPATCH_LOG"
    ;;
  pr)
    # No open PRs: these tests are about the guard, not the merge loop.
    printf ''
    ;;
  *) printf '' ;;
esac
exit 0
STUB
  chmod +x "$tmp/gh"

  PATH="$tmp:$PATH" \
  STUB_BASE_SHA="$base_sha" \
  STUB_RUNS_JSON="$runs_json" \
  STUB_DISPATCH_LOG="$DISPATCH_LOG" \
  GH_REPO="bitbaum/testrepo" \
  BASE_BRANCH="main" \
  CI_WORKFLOW="ci.yml" \
  DEPLOY_WORKFLOW="" \
    bash "$SWEEP" 2>&1

  rm -rf "$tmp"
}

# Reset the dispatch record, then run one case.
#
# The caller reads $DISPATCH_LOG itself afterwards — it cannot be captured into
# a variable in here, because this function is invoked as $(sweep_case …) and
# every assignment inside a command substitution dies with the subshell.
DISPATCH_LOG=$(mktemp)
sweep_case() {
  : > "$DISPATCH_LOG"
  run_sweep "$1" "$2"
}
dispatched() { grep -q "$1" "$DISPATCH_LOG"; }

echo "auto-merge-sweep-no-base-ci:"

# ── THE BUG ─────────────────────────────────────────────────────────────────
# Base tip aaaa1111 has no CI run. The newest run belongs to an older commit
# and is completed. Nothing is in flight. This is the exact loki steady state.
out=$(sweep_case "aaaa1111" '[
  {"databaseId":1,"status":"completed","conclusion":"success","headSha":"bbbb2222"},
  {"databaseId":2,"status":"completed","conclusion":"success","headSha":"cccc3333"}
]')
if dispatched "ci.yml"; then
  pass "THE BUG: with no CI run for the tip and none in flight, CI is dispatched"
else
  fail "THE BUG: with no CI run for the tip and none in flight, CI is dispatched" \
       "nothing was dispatched — the sweep is deadlocked. output: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
fi

# It must still refuse to merge onto a base it has no verdict for.
if printf '%s' "$out" | grep -qi "merging\|merged #"; then
  fail "it still refuses to merge onto an unverified base" "it merged something"
else
  pass "it still refuses to merge onto an unverified base"
fi

# ── THE GUARD IT MUST NOT BREAK ─────────────────────────────────────────────
# A run for a newer commit is genuinely in flight: CI really is catching up.
# Dispatching a second run here is what caused the concurrency-cancellation
# storm on loki 2026-09-10, so this path must stay a plain wait.
out=$(sweep_case "aaaa1111" '[
  {"databaseId":3,"status":"in_progress","conclusion":null,"headSha":"dddd4444"}
]')
if dispatched "ci.yml"; then
  fail "CI genuinely in flight is waited for, not re-dispatched" \
       "it dispatched anyway: $(cat "$DISPATCH_LOG")"
else
  pass "CI genuinely in flight is waited for, not re-dispatched"
fi
if printf '%s' "$out" | grep -q "waiting for CI to catch up"; then
  pass "and it says so"
else
  fail "and it says so" "expected 'waiting for CI to catch up', got: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
fi

# ── THE NORMAL PATH ─────────────────────────────────────────────────────────
# A green run exists for the tip: no dispatch, no deferral on this account.
out=$(sweep_case "aaaa1111" '[
  {"databaseId":4,"status":"completed","conclusion":"success","headSha":"aaaa1111"}
]')
if dispatched "ci.yml"; then
  fail "a verified tip triggers no dispatch from the guard" "it dispatched: $(cat "$DISPATCH_LOG")"
else
  pass "a verified tip triggers no dispatch from the guard"
fi
if printf '%s' "$out" | grep -q "waiting for CI to catch up"; then
  fail "a verified tip is not deferred" "it deferred: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
else
  pass "a verified tip is not deferred"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "auto-merge-sweep-no-base-ci: all good"
  exit 0
fi
echo "auto-merge-sweep-no-base-ci: $failures failure(s)"
exit 1
