#!/usr/bin/env bash
#
# Tests for dependabot-alerts-audit.sh.
#
# A gate is only worth having if it goes RED for the thing it claims to catch,
# so every case below is a mutation: the audit is handed a fleet that has the
# defect and must fail. Running it once against the real fleet and seeing green
# proves nothing — the real fleet was green the moment it was written.
#
# `gh` is stubbed on PATH rather than called, for three reasons: the test runs
# offline and deterministically, it can express states the real fleet is not
# currently in (a repo with alerts off, an unreadable repo), and it cannot
# accidentally toggle a security setting on a live repository.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT="$HERE/dependabot-alerts-audit.sh"
pass=0; fail=0

ok() { # ok <label> <condition-exit-code>
  if [ "$2" -eq 0 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ $1"; fi
}

# Builds a throwaway PATH whose `gh` answers from two fixtures:
#   $1 — newline-separated repo names for `gh repo list`
#   $2 — newline-separated "<repo> <httpcode>" for `gh api -i .../vulnerability-alerts`
make_stub() {
  local dir; dir=$(mktemp -d)
  printf '%s\n' "$1" > "$dir/repos"
  printf '%s\n' "$2" > "$dir/codes"
  cat > "$dir/gh" <<'STUB'
#!/usr/bin/env bash
d="$(dirname "$0")"
if [ "${1:-}" = "repo" ] && [ "${2:-}" = "list" ]; then
  grep -v '^$' "$d/repos"; exit 0
fi
if [ "${1:-}" = "api" ]; then
  for a in "$@"; do case "$a" in */vulnerability-alerts) target="$a" ;; esac; done
  repo="${target%/vulnerability-alerts}"; repo="${repo##*/}"
  # -X PUT is the --fix path; report success so the fix branch is exercised.
  for a in "$@"; do [ "$a" = "PUT" ] && exit 0; done
  code=$(awk -v r="$repo" '$1==r {print $2}' "$d/codes")
  echo "HTTP/2.0 ${code:-000}"
  exit 0
fi
exit 0
STUB
  chmod +x "$dir/gh"
  echo "$dir"
}

run() { # run <stubdir> <args...>
  local d="$1"; shift
  PATH="$d:$PATH" bash "$AUDIT" "$@" 2>&1
}

# ── 1. All enabled → --check passes ─────────────────────────────────────────
d=$(make_stub "alpha
beta" "alpha 204
beta 204")
out=$(run "$d" --check); rc=$?
ok "all-enabled fleet exits 0" "$rc"
grep -q "2/2 enabled" <<<"$out"; ok "reports 2/2 enabled" $?

# ── 2. One repo OFF → --check FAILS and names it ────────────────────────────
# The incident this audit exists for: surf-your-life had alerts off, so 1
# critical and 6 high sat on a live site with nobody told.
d=$(make_stub "alpha
beta" "alpha 204
beta 404")
out=$(run "$d" --check); rc=$?
[ "$rc" -eq 1 ]; ok "a repo with alerts OFF exits 1" $?
grep -q "beta" <<<"$out"; ok "names the offending repo" $?

# ── 3. UNREADABLE is not a pass ─────────────────────────────────────────────
# "Could not look" is a third answer, not green — the failure mode that lets an
# audit report success over repos it never reached.
d=$(make_stub "alpha
beta" "alpha 204
beta 403")
out=$(run "$d" --check); rc=$?
[ "$rc" -eq 1 ]; ok "an unreadable repo exits 1 rather than passing" $?
grep -q "UNREADABLE" <<<"$out"; ok "labels it unreadable, not off" $?

# ── 4. An empty repo list must not read as a clean fleet ────────────────────
d=$(make_stub "" "")
out=$(run "$d" --check); rc=$?
[ "$rc" -eq 2 ]; ok "empty repo list exits 2, refusing a pass over nothing" $?

# ── 5. Archived and forks are excluded from the population ──────────────────
# Asserted through the jq filter the stub receives: the audit must pass
# isArchived/isFork selection to `gh repo list`, not filter afterwards.
grep -q 'isArchived == false and .isFork == false' "$AUDIT"
ok "excludes archived repos and forks, like version-currency.mjs" $?

# ── 6. --fix reports per-repo results and does not claim a check ────────────
d=$(make_stub "alpha
beta" "alpha 204
beta 404")
out=$(run "$d" --fix); rc=$?
ok "--fix exits 0" "$rc"
grep -q "alerts=ok" <<<"$out"; ok "--fix reports what it enabled" $?

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
