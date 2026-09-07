#!/usr/bin/env bash
# Prove cicd-hygiene-audit.sh by MUTATION, not by watching it exit 0.
#
# An audit that passes proves nothing on its own: a predicate that never matches
# also passes, and this fleet has shipped exactly that (a named gate that was
# inert, a ratchet that indexed its own baseline). So every check here is run
# against a fixture that SHOULD trip it and one that should NOT, and the test
# fails if either answer is wrong.
#
# Fixtures are local directories, so this runs with no network and no GitHub
# token — which is also what makes it safe to run on every PR.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AUDIT="$HERE/cicd-hygiene-audit.sh"
[ -f "$AUDIT" ] || { echo "audit script not found: $AUDIT" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

ok()   { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  ✗ %s\n' "$1"; }

# mkrepo <name> <is-next: yes|no>; then write workflow files into $TMP/<name>/workflows
mkrepo() {
  local n="$1" isnext="${2:-no}"
  mkdir -p "$TMP/$n/workflows"
  [ "$isnext" = yes ] && : > "$TMP/$n/.is-next"
}

run_audit() {
  CICD_HYGIENE_FIXTURE_DIR="$TMP" bash "$AUDIT" 2>/dev/null
}

# Count violations reported for a given check.
count_for() {
  run_audit | awk -v k="$1" '$1==k {print $2; exit}'
}

echo "cicd-hygiene-audit predicates"

# ── deploy-cancels ───────────────────────────────────────────────────────────
mkrepo cancels
cat > "$TMP/cancels/workflows/deploy.yml" <<'YML'
name: Deploy
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true
jobs: { deploy: { steps: [] } }
YML
[ "$(count_for deploy-cancels)" = "1" ] \
  && ok "flags cancel-in-progress: true in a deploy workflow" \
  || bad "did NOT flag cancel-in-progress: true in a deploy workflow"

# CI may cancel — that is correct, and flagging it would make the audit noise.
rm -rf "${TMP:?}"/*; mkrepo ciCancels
cat > "$TMP/ciCancels/workflows/ci.yml" <<'YML'
name: CI
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs: { verify: { steps: [] } }
YML
[ "$(count_for deploy-cancels)" = "0" ] \
  && ok "does NOT flag cancel-in-progress in a CI workflow" \
  || bad "wrongly flagged cancel-in-progress in a CI workflow"

# A deploy that EXPLAINS why it does not cancel must not be flagged by its prose.
rm -rf "${TMP:?}"/*; mkrepo commented
cat > "$TMP/commented/workflows/deploy.yml" <<'YML'
name: Deploy
# Deliberately not cancel-in-progress: true — a 13-minute deploy that is
# cancelled leaves main undeployed.
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false
jobs: { deploy: { steps: [] } }
YML
[ "$(count_for deploy-cancels)" = "0" ] \
  && ok "is comment-blind-proof: prose mentioning the flag is not a violation" \
  || bad "flagged a COMMENT mentioning cancel-in-progress: true"

# ── deploy-reverifies ────────────────────────────────────────────────────────
rm -rf "${TMP:?}"/*; mkrepo dup
cat > "$TMP/dup/workflows/ci.yml" <<'YML'
name: CI
jobs: { verify: { steps: [ { run: pnpm run verify } ] } }
YML
cat > "$TMP/dup/workflows/deploy.yml" <<'YML'
name: Deploy
jobs: { deploy: { steps: [ { run: pnpm run verify }, { run: bash deploy.sh } ] } }
YML
[ "$(count_for deploy-reverifies)" = "1" ] \
  && ok "flags a deploy re-running the verify bundle CI already runs" \
  || bad "did NOT flag a deploy re-running CI's verify bundle"

# The point is DUPLICATION. A repo whose only verification lives in its deploy
# is not duplicating anything, and telling it to stop would remove its gate.
rm -rf "${TMP:?}"/*; mkrepo onlydeploy
cat > "$TMP/onlydeploy/workflows/deploy.yml" <<'YML'
name: Deploy
jobs: { deploy: { steps: [ { run: pnpm run verify }, { run: bash deploy.sh } ] } }
YML
[ "$(count_for deploy-reverifies)" = "0" ] \
  && ok "does NOT flag a deploy whose verify is the repo's only one" \
  || bad "flagged a deploy that is the sole verifier"

# ── cold-ci-build ────────────────────────────────────────────────────────────
rm -rf "${TMP:?}"/*; mkrepo cold yes
cat > "$TMP/cold/workflows/ci.yml" <<'YML'
name: CI
jobs: { verify: { steps: [ { run: pnpm run build } ] } }
YML
[ "$(count_for cold-ci-build)" = "1" ] \
  && ok "flags a Next repo whose CI builds with no .next/cache" \
  || bad "did NOT flag a cold CI build in a Next repo"

rm -rf "${TMP:?}"/*; mkrepo warm yes
cat > "$TMP/warm/workflows/ci.yml" <<'YML'
name: CI
jobs:
  verify:
    steps:
      - uses: actions/cache@v4
        with:
          path: .next/cache
          key: nextjs-x
      - run: pnpm run build
YML
[ "$(count_for cold-ci-build)" = "0" ] \
  && ok "does NOT flag a Next repo that caches .next/cache" \
  || bad "flagged a repo that DOES cache .next/cache"

# A non-Next repo has no .next/cache to restore; flagging it would be noise.
rm -rf "${TMP:?}"/*; mkrepo notnext no
cat > "$TMP/notnext/workflows/ci.yml" <<'YML'
name: CI
jobs: { verify: { steps: [ { run: npm run build } ] } }
YML
[ "$(count_for cold-ci-build)" = "0" ] \
  && ok "does NOT flag a non-Next repo for missing a Next cache" \
  || bad "flagged a non-Next repo for missing .next/cache"

# ── the ratchet itself ───────────────────────────────────────────────────────
# A ratchet that cannot fail is the failure mode this fleet keeps hitting, so
# assert BOTH directions against a baseline rather than trusting exit 0.
rm -rf "${TMP:?}"/*; mkrepo r1
cat > "$TMP/r1/workflows/deploy.yml" <<'YML'
name: Deploy
concurrency: { cancel-in-progress: true }
jobs: { deploy: { steps: [] } }
YML
BL="$TMP/.baseline"
printf 'deploy-cancels\t0\ndeploy-reverifies\t0\ncold-ci-build\t0\n' > "$BL"
if CICD_HYGIENE_FIXTURE_DIR="$TMP" CICD_HYGIENE_BASELINE="$BL" \
     bash "$AUDIT" --check >/dev/null 2>&1; then
  bad "--check PASSED although a count rose above the baseline"
else
  ok "--check fails when a count rises above the baseline"
fi

printf 'deploy-cancels\t1\ndeploy-reverifies\t0\ncold-ci-build\t0\n' > "$BL"
if CICD_HYGIENE_FIXTURE_DIR="$TMP" CICD_HYGIENE_BASELINE="$BL" \
     bash "$AUDIT" --check >/dev/null 2>&1; then
  ok "--check passes when the count matches the baseline"
else
  bad "--check FAILED although the count matches the baseline"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ] || exit 1
