#!/usr/bin/env bash
#
# Negative tests for the verify-contract WIRING rules.
#
# The rules live in verify-predicates.sh precisely so they can be tested without
# reaching GitHub — the audit that uses them is remote-only, and a rule that can
# only be exercised by a live API call is a rule nobody re-tests after changing
# one of its regexes.
#
# Both directions are tested on purpose. Proving a rule BITES is half the job;
# proving it stays quiet on a conforming repo is the other half, and skipping it
# is how a checker starts crying wolf and gets ignored — the same end state as
# having no checker, reached more expensively.

set -uo pipefail

# shellcheck source=scripts/ci/verify-predicates.sh
. "$(cd "$(dirname "$0")" && pwd)/verify-predicates.sh"

PASS=0
FAIL=0

ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

# assert <expected pass|fail> <predicate> <input> <description>
assert() {
  local want="$1" pred="$2" input="$3" desc="$4"
  if "$pred" "$input"; then got=pass; else got=fail; fi
  [ "$got" = "$want" ] && ok "$desc" || no "$desc (expected $want, got $got)"
}

CALLS='jobs:
  verify:
    steps:
      - name: Verify
        run: npm run verify'

HANDCOPIED='jobs:
  verify:
    steps:
      - name: Lint
        run: npm run lint --if-present
      - name: Test
        run: npm run test --if-present'

SOFTENED='jobs:
  verify:
    steps:
      - name: Verify
        run: npm run verify --if-present'

BENIGN_IFPRESENT='jobs:
  verify:
    steps:
      - name: Optional docs
        run: npm run docs --if-present
      - name: Verify
        run: npm run verify'

echo "ci_invokes_verify"
assert pass ci_invokes_verify "$CALLS"        'npm run verify is detected'
assert pass ci_invokes_verify 'run: pnpm verify'  'pnpm implicit-run is accepted (was a false positive once)'
assert pass ci_invokes_verify 'run: yarn verify'  'yarn implicit-run is accepted'
assert pass ci_invokes_verify 'run: bun run verify' 'bun is accepted'
assert fail ci_invokes_verify "$HANDCOPIED"   'hand-copied steps do NOT count as calling verify'
assert fail ci_invokes_verify 'run: npm run verify-deploy' 'a longer script name is not mistaken for verify'
assert fail ci_invokes_verify ''              'an empty workflow body is not a call'

echo "ci_verify_softened"
assert pass ci_verify_softened "$SOFTENED"          '--if-present ON the verify step is caught'
assert fail ci_verify_softened "$CALLS"             'a clean verify step is not flagged'
assert fail ci_verify_softened "$BENIGN_IFPRESENT"  '--if-present on an UNRELATED step is not flagged'

echo "verify_softens_itself"
assert pass verify_softens_itself 'eslint . || true'                   '|| true inside verify is caught'
assert pass verify_softens_itself 'npm run typecheck --workspaces --if-present' '--if-present inside verify is caught'
assert fail verify_softens_itself 'pnpm lint && pnpm typecheck && pnpm test' 'a clean verify is not flagged'
assert fail verify_softens_itself ''                                   'an empty verify is not flagged here — absence is the audit job'

# assert2 <expected pass|fail> <predicate> <arg1> <arg2> <description>
assert2() {
  local want="$1" pred="$2" a="$3" b="$4" desc="$5"
  if "$pred" "$a" "$b"; then got=pass; else got=fail; fi
  [ "$got" = "$want" ] && ok "$desc" || no "$desc (expected $want, got $got)"
}

VERIFY_NPM='npm run lint && npm run typecheck && npm run test'

# aoz-housing's real shape: the same three scripts, split across parallel jobs
# for speed, none of them softened. This is the case that proved the
# string-match rule wrong.
AOZ_WF='  - name: Lint
    run: npm run lint
  - name: Type check
    run: npm run typecheck
  - name: Run unit tests
    run: npm test -- --ci --coverage
  - name: Build
    run: npm run build'

# Same split, but one gate quietly absent.
AOZ_MISSING_TYPECHECK='  - name: Lint
    run: npm run lint
  - name: Run unit tests
    run: npm test -- --ci --coverage'

echo "verify_gate_scripts"
got=$(verify_gate_scripts "$VERIFY_NPM" | tr '\n' ' ')
[ "$got" = "lint test typecheck " ] \
  && ok "decomposes verify into its named gates" \
  || no "decomposes verify into its named gates (got '$got')"
got=$(verify_gate_scripts 'eslint . && tsc --noEmit && jest')
[ -z "$got" ] \
  && ok "a verify that shells out directly decomposes to nothing" \
  || no "a verify that shells out directly decomposes to nothing (got '$got')"

echo "ci_runs_verify_gates"
assert2 pass ci_runs_verify_gates "$AOZ_WF" "$VERIFY_NPM" \
  'aoz-housing: gates run individually, unsoftened → satisfied'
assert2 fail ci_runs_verify_gates "$AOZ_MISSING_TYPECHECK" "$VERIFY_NPM" \
  'a gate in verify that CI never runs → NOT satisfied'
assert2 fail ci_runs_verify_gates "$HANDCOPIED" 'npm run lint && npm run test' \
  'botsmann: hand-copied AND --if-present on every step → still caught'
assert2 fail ci_runs_verify_gates "$AOZ_WF" 'eslint . && tsc --noEmit' \
  'an undecomposable verify is unproven, not waved through'
assert2 fail ci_runs_verify_gates '' "$VERIFY_NPM" \
  'no workflows at all → NOT satisfied'
assert2 pass ci_runs_verify_gates 'run: pnpm lint
run: pnpm typecheck
run: pnpm test' 'pnpm lint && pnpm typecheck && pnpm test' \
  'pnpm implicit-run spelling works on both sides'

# --- gh_get: the three states ------------------------------------------------
# This is the test that would have caught the 2026-08-16 miscount. `gh` is
# stubbed so the FAILURE path is reachable without a real outage — which is
# exactly why the bug survived: nothing could exercise it.

GH_GET_BACKOFF=0   # do not actually sleep through the retries in tests

echo "gh_get"

gh() { printf 'ok-body'; return 0; }
out=$(gh_get 'any/path'); rc=$?
[ "$rc" = 0 ] && [ "$out" = "ok-body" ] \
  && ok "success returns 0 and the body" \
  || no "success returns 0 and the body (rc=$rc out='$out')"

gh() { echo 'gh: Not Found (HTTP 404)' >&2; return 1; }
gh_get 'missing/path' >/dev/null; rc=$?
[ "$rc" = 2 ] \
  && ok "a real 404 is ABSENT (2), distinct from a failure" \
  || no "a real 404 is ABSENT (2) (rc=$rc)"

gh() { echo 'gh: HTTP 403 rate limit exceeded' >&2; return 1; }
gh_get 'blocked/path' >/dev/null; rc=$?
[ "$rc" = 1 ] \
  && ok "a 403 is COULD-NOT-LOOK (1), never mistaken for absence" \
  || no "a 403 is COULD-NOT-LOOK (1) (rc=$rc)"

gh() { echo 'gh: HTTP 502 Bad Gateway' >&2; return 1; }
gh_get 'flaky/path' >/dev/null; rc=$?
[ "$rc" = 1 ] \
  && ok "a 5xx is COULD-NOT-LOOK (1), not absence" \
  || no "a 5xx is COULD-NOT-LOOK (1) (rc=$rc)"

# Transient then success: the retry must actually rescue the call, otherwise
# every blip still costs a repo its verdict.
ATTEMPTS_FILE=$(mktemp)
echo 0 > "$ATTEMPTS_FILE"
gh() {
  local n; n=$(cat "$ATTEMPTS_FILE"); n=$((n + 1)); echo "$n" > "$ATTEMPTS_FILE"
  if [ "$n" -lt 2 ]; then echo 'gh: HTTP 502' >&2; return 1; fi
  printf 'recovered'; return 0
}
out=$(gh_get 'flaky/path'); rc=$?
[ "$rc" = 0 ] && [ "$out" = "recovered" ] \
  && ok "a transient failure is retried and recovers" \
  || no "a transient failure is retried and recovers (rc=$rc out='$out')"

# A 404 must NOT burn retries — it is an answer, and retrying it would triple
# the cost of every genuinely-absent file across the fleet.
echo 0 > "$ATTEMPTS_FILE"
gh() {
  local n; n=$(cat "$ATTEMPTS_FILE"); n=$((n + 1)); echo "$n" > "$ATTEMPTS_FILE"
  echo 'gh: Not Found (HTTP 404)' >&2; return 1
}
gh_get 'missing/path' >/dev/null
[ "$(cat "$ATTEMPTS_FILE")" = 1 ] \
  && ok "a 404 is not retried (costs one call, not three)" \
  || no "a 404 is not retried (took $(cat "$ATTEMPTS_FILE") calls)"

# An exhausted rate limit is not retried either: seconds of backoff cannot
# outlive an hour-long window, and retrying burns calls when they're scarcest.
# It is still COULD-NOT-LOOK (1) — a transport fact, never absence.
echo 0 > "$ATTEMPTS_FILE"
gh() {
  local n; n=$(cat "$ATTEMPTS_FILE"); n=$((n + 1)); echo "$n" > "$ATTEMPTS_FILE"
  echo 'gh: HTTP 403 API rate limit exceeded for user' >&2; return 1
}
gh_get 'starved/path' >/dev/null; rc=$?
[ "$rc" = 1 ] && [ "$(cat "$ATTEMPTS_FILE")" = 1 ] \
  && ok "a rate-limited call fails fast as COULD-NOT-LOOK (1 call, rc=1)" \
  || no "a rate-limited call fails fast (rc=$rc, took $(cat "$ATTEMPTS_FILE") calls)"
rm -f "$ATTEMPTS_FILE"
unset -f gh

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
