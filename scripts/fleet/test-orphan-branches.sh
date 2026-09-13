#!/usr/bin/env bash
#
# orphan-branches.sh, against real git repos.
#
# The interesting cases are all "looks merged but is not" and "looks orphaned
# but is not", so fixtures are built with real commits and real remotes rather
# than asserted against a mock.
#
# `gh` is not available to these tests, so the PR filter comes back empty —
# which is the strictest case: every branch that clears the other two filters is
# reported. The tests that care about the PR filter say so.

set -uo pipefail
cd "$(dirname "$0")"
SCRIPT="$PWD/orphan-branches.sh"

PASS=0 FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
# The EXIT trap is inherited by every $(...) subshell and bash runs it when the
# subshell ends, so an unguarded `rm -rf "$TMP"` deletes the fixtures during the
# first assertion. Every later "must NOT contain" test then passes on empty
# output — six green ticks for a suite with no fixtures left. Fire only in the
# process that made the directory.
MAINPID=$$
trap '[ "$$" = "$MAINPID" ] && rm -rf "$TMP"' EXIT

# `git -C ""` silently operates on the CURRENT repository. When $1 came back
# empty, this harness ran `add -A` and `commit` inside the real fleet checkout,
# swept two untracked files into a fixture commit, created six junk branches and
# pushed one to the remote. A test fixture must not be able to reach a real
# repo, so every path is checked to be inside $TMP before git sees it.
git_q() {
  case "${1:-}" in
    "$TMP"/*) ;;
    *) echo "REFUSING: fixture path '${1:-}' is not under \$TMP" >&2; exit 1 ;;
  esac
  git -C "$1" -c user.email=t@t -c user.name=t -c init.defaultBranch=main "${@:2}"
}

# A bare repo to act as origin, and a clone with a main branch on it.
make_repo() {
  # Declared separately on purpose: under `set -u`, referring to `name` inside
  # the same `local` statement that defines it is not reliably in scope. When
  # that failed, make_repo returned an EMPTY path — which `git -C ""` happily
  # resolved to the real repository this test lives in.
  local name="$1"
  local dir="$TMP/$name"
  local remote="$TMP/$name.git"
  git init -q --bare "$remote"
  git init -q -b main "$dir"
  echo one > "$dir/f.txt"
  git_q "$dir" add -A
  git_q "$dir" commit --no-verify -qm "base"
  git_q "$dir" remote add origin "$remote"
  git_q "$dir" push -q -u origin main 2>/dev/null
  [ -d "$dir/.git" ] || { echo "make_repo failed for $name" >&2; exit 1; }
  echo "$dir"
}

commit_on() {  # commit_on <dir> <branch> <text>
  git_q "$1" checkout -q -b "$2" 2>/dev/null || git_q "$1" checkout -q "$2"
  echo "$3" >> "$1/f.txt"
  git_q "$1" add -A
  git_q "$1" commit --no-verify -qm "$3"
}

run() { FLEET_ROOT="$TMP" bash "$SCRIPT" "$@" 2>/dev/null; }

echo "orphan-branches:"

# Regression: this suite once ran `git -C "" add -A && commit` inside the real
# fleet checkout, because make_repo aborted and returned an empty path. It swept
# two untracked files into a fixture commit, created six branches and pushed one
# to the remote. The guard below is why that cannot happen again, so it is
# tested before anything else runs.
( git_q "" status ) >/dev/null 2>&1; rc=$?
[ "$rc" -ne 0 ] \
  && ok "git_q refuses an empty path instead of using the real repo" \
  || no "an empty fixture path must be refused (rc=$rc)"

( git_q /home/g/dev/fleet status ) >/dev/null 2>&1; rc=$?
[ "$rc" -ne 0 ] \
  && ok "...and refuses any path outside \$TMP" \
  || no "a real repo path must be refused (rc=$rc)"

# ---------------------------------------------------------------------------
R="$(make_repo alpha)"
out="$(run)"
[ -z "$out" ] \
  && ok "a repo with only main says nothing" \
  || no "expected silence, got '$out'"

# ---------------------------------------------------------------------------
commit_on "$R" feat/never-pushed "local work"
out="$(run)"
[[ "$out" == *"feat/never-pushed"* ]] \
  && ok "a branch that never left the machine is reported" \
  || no "expected the orphan to be named, got '$out'"

# ---------------------------------------------------------------------------
# THE CASE THIS TOOL EXISTS FOR: the orphan is not the checked-out branch, so
# a working-tree check (clean? unpushed on HEAD?) sees nothing wrong.
git_q "$R" checkout -q main
[ -z "$(git_q "$R" status --porcelain)" ] || no "fixture should be clean"
out="$(run)"
[[ "$out" == *"feat/never-pushed"* ]] \
  && ok "...even when it is not checked out and the tree is clean" \
  || no "the blind spot is back: '$out'"

# ---------------------------------------------------------------------------
commit_on "$R" feat/pushed "shared work"
git_q "$R" push -q -u origin feat/pushed 2>/dev/null
out="$(run)"
[[ "$out" != *"feat/pushed"* ]] \
  && ok "a pushed branch is not an orphan" \
  || no "a branch with a remote ref must not be reported: '$out'"

# ---------------------------------------------------------------------------
# Merged INTO main by a normal merge: the patch is in main, so cherry says so.
git_q "$R" checkout -q -b feat/merged main
echo merged >> "$R/f.txt"
git_q "$R" add -A
git_q "$R" commit --no-verify -qm "merged work"
git_q "$R" checkout -q main
git_q "$R" merge -q --no-ff -m "merge" feat/merged
git_q "$R" push -q origin main 2>/dev/null
out="$(run)"
[[ "$out" != *"feat/merged"* ]] \
  && ok "a branch whose commits are already in main is not an orphan" \
  || no "merged work must not be reported: '$out'"

# ---------------------------------------------------------------------------
for f in stale other; do commit_on "$R" "$f" "fixture"; done
git_q "$R" checkout -q main
out="$(run)"
[[ "$out" != *"  stale"* ]] && [[ "$out" != *"  other"* ]] \
  && ok "test-fixture branch names are never reported (nor pushable)" \
  || no "fixtures must be skipped: '$out'"

# ---------------------------------------------------------------------------
out="$(run --days 1)"
[[ "$out" == *"feat/never-pushed"* ]] \
  && ok "--days keeps a branch committed just now" \
  || no "a fresh branch should survive --days 1: '$out'"

# An old one, dated by committer date.
git_q "$R" checkout -q -b feat/ancient main
echo old >> "$R/f.txt"
git_q "$R" add -A
GIT_COMMITTER_DATE="2020-01-01T00:00:00" git_q "$R" commit --no-verify -qm "ancient" --date="2020-01-01T00:00:00"
git_q "$R" checkout -q main
out="$(run --days 1)"
[[ "$out" != *"feat/ancient"* ]] \
  && ok "--days drops one older than the window" \
  || no "an ancient branch must be filtered by --days: '$out'"
out="$(run)"
[[ "$out" == *"feat/ancient"* ]] \
  && ok "...and reports it again with no window" \
  || no "without --days everything orphaned is listed: '$out'"

# ---------------------------------------------------------------------------
run --push >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] \
  && ok "--push without --days is refused, not silently fleet-wide" \
  || no "--push alone should exit 2, got $rc"

out="$(run --nonsense 2>&1)"; rc=$?
[ "$rc" -eq 2 ] \
  && ok "an unknown argument fails loudly rather than defaulting to a pass" \
  || no "bad args should exit 2, got $rc"

# ---------------------------------------------------------------------------
before="$(git -C "$TMP/alpha.git" for-each-ref --format='%(refname:short)' refs/heads | wc -l)"
run --days 1 --push >/dev/null 2>&1
after="$(git -C "$TMP/alpha.git" for-each-ref --format='%(refname:short)' refs/heads | wc -l)"
[ "$after" -gt "$before" ] \
  && ok "--push actually creates the ref on the remote ($before -> $after)" \
  || no "--push did not push anything ($before -> $after)"

git -C "$TMP/alpha.git" rev-parse --verify -q refs/heads/stale >/dev/null 2>&1 \
  && no "--push published a fixture branch" \
  || ok "...and still refuses to publish a fixture"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
