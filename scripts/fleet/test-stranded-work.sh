#!/usr/bin/env bash
#
# Negative tests for the stranded-work guard.
#
# The guard's entire value is that it can go RED, and its entire usability is
# that it stays SILENT otherwise. Both halves are failure modes:
#
#   - If it never fires, it certifies the thing it was built to catch. That is
#     how 206 finished files sat on one disk for ten days while `git-health`
#     cheerfully reported them every single day.
#   - If it fires on healthy work, it gets muted, and a muted check is absent.
#     This is the more likely death, so "young dirty tree says nothing" is
#     tested as carefully as "old dirty tree speaks up".
#
# The deciding half is pure text and is tested against fixtures. The scanning
# half is tested against REAL git repos built in a tmpdir with backdated files,
# because the thing most likely to be wrong is the mtime and rename parsing,
# and no fixture would exercise that.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/stranded-work.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

export STRANDED_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT" ""
unset STRANDED_LIB_ONLY

# name  dirty  dirty_age  unpushed  unpushed_age  branch
row() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$@"; }

echo "deciding half — fixtures, no git:"

out="$(row clean 0 -1 0 -1 main | decide 3)"; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] \
  && ok "a clean repo says nothing and exits 0" \
  || no "a clean repo should be silent (rc=$rc, out='$out')"

out="$(row busy 42 0 0 -1 main | decide 3)"; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] \
  && ok "42 files dirty since today is work, not a finding" \
  || no "a fresh dirty tree must stay silent (rc=$rc, out='$out')"

out="$(row busy 42 2 0 -1 main | decide 3)"; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] \
  && ok "dirty for 2d is below a 3d threshold and stays silent" \
  || no "2d < 3d must stay silent (rc=$rc)"

out="$(row oc 118 10 0 -1 chore/x | decide 3)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"118 uncommitted"* ]] && [[ "$out" == *"10d"* ]] \
  && ok "the real orangecat case goes red and names the age" \
  || no "118 files dirty 10d must go red (rc=$rc, out='$out')"

out="$(row edge 1 3 0 -1 main | decide 3)"; rc=$?
[ $rc -ne 0 ] \
  && ok "exactly at the threshold counts as stranded (>=, not >)" \
  || no "age == threshold must fire"

out="$(row fc 0 -1 4 11 fix/y | decide 3)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"4 unpushed"* ]] \
  && ok "committed-but-never-pushed is caught too (fleetcrown's 4)" \
  || no "unpushed commits must go red (rc=$rc, out='$out')"

out="$(row both 9 5 2 6 main | decide 3)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"uncommitted"* ]] && [[ "$out" == *"unpushed"* ]] \
  && ok "a repo stranded both ways reports both reasons" \
  || no "both reasons should appear (out='$out')"

out="$(row young 0 -1 3 0 main | decide 3)"; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] \
  && ok "commits pushed-pending since today stay silent" \
  || no "fresh unpushed commits must stay silent (rc=$rc)"

out="$(printf '%s%s%s' "$(row a 0 -1 0 -1 main)"$'\n' "$(row b 7 9 0 -1 main)"$'\n' "$(row c 0 -1 0 -1 main)"$'\n' | decide 3)"; rc=$?
[ $rc -ne 0 ] && [ "$(printf '%s\n' "$out" | grep -c .)" -eq 1 ] \
  && ok "only the stranded repo is listed, not the healthy ones" \
  || no "exactly one line expected (out='$out')"

echo
echo "scanning half — real git repos with backdated files:"

mkrepo_at() {
  local d="$1/$2"; mkdir -p "$d"; git -C "$d" init -q
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo seed > "$d/seed.txt"; git -C "$d" add -A
  git -C "$d" commit -qm seed --no-verify
  printf '%s' "$d"
}

mkrepo() {
  local d="$TMP/$1"; mkdir -p "$d"; git -C "$d" init -q
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo seed > "$d/seed.txt"; git -C "$d" add -A
  git -C "$d" commit -qm seed --no-verify
  printf '%s' "$d"
}

d="$(mkrepo fresh)"
line="$(scan_repo "$d")"
[ "$(printf '%s' "$line" | cut -f2)" = "0" ] \
  && ok "a committed repo scans as 0 dirty" \
  || no "expected 0 dirty, got '$line'"

d="$(mkrepo aged)"
echo change >> "$d/seed.txt"
echo new > "$d/untracked.txt"
touch -d '9 days ago' "$d/seed.txt" "$d/untracked.txt"
line="$(scan_repo "$d")"
n="$(printf '%s' "$line" | cut -f2)"; age="$(printf '%s' "$line" | cut -f3)"
[ "$n" = "2" ] && [ "$age" -ge 8 ] \
  && ok "modified + untracked both counted, age read from mtime (${age}d)" \
  || no "expected 2 files aged ~9d, got n=$n age=$age"

# A deleted file has no mtime to stat. It must still count, and must not abort
# the scan or poison the age — this is the case that silently breaks naive
# implementations, and orangecat's rename deleted 18 files.
d="$(mkrepo deleted)"
echo x > "$d/gone.txt"; git -C "$d" add -A; git -C "$d" commit -qm two --no-verify
rm "$d/gone.txt"
line="$(scan_repo "$d")"
n="$(printf '%s' "$line" | cut -f2)"
[ "$n" = "1" ] \
  && ok "a deletion counts as dirty without breaking the mtime scan" \
  || no "expected 1 dirty for a deletion, got '$line'"

d="$(mkrepo renamed)"
git -C "$d" mv seed.txt moved.txt
touch -d '7 days ago' "$d/moved.txt"
line="$(scan_repo "$d")"
n="$(printf '%s' "$line" | cut -f2)"; age="$(printf '%s' "$line" | cut -f3)"
[ "$n" = "1" ] && [ "$age" -ge 6 ] \
  && ok "a rename resolves to its new path, not the vanished old one (${age}d)" \
  || no "expected the renamed path to be statted, got n=$n age=$age"

d="$(mkrepo unpushed)"
echo more >> "$d/seed.txt"; git -C "$d" add -A
GIT_COMMITTER_DATE="$(date -d '12 days ago' -Iseconds)" \
  git -C "$d" -c user.email=t@t -c user.name=t commit -qm "old work" --no-verify \
  --date="$(date -d '12 days ago' -Iseconds)"
line="$(scan_repo "$d")"
[ "$(printf '%s' "$line" | cut -f2)" = "0" ] \
  && ok "a repo with no remote scans without erroring" \
  || no "no-remote repo should scan cleanly, got '$line'"

echo
echo "worktrees — the blind spot that made this guard certify a lie:"

# The fleet works almost entirely in `git worktree` checkouts created per agent
# session. Scanning only $FLEET_ROOT/*/ therefore missed the majority of real
# work: 26 unpushed commits across the fleet on 2026-08-25, oldest 25 days,
# while the guard printed nothing. These pin the fix.
wt_root="$TMP/wtfleet"; mkdir -p "$wt_root"
d="$(mkrepo_at "$wt_root" withwt)"
# A real remote, because "unpushed" is meaningless without one — scan_repo
# measures against @{u} or origin/main and correctly reports nothing when
# neither exists.
git init -q --bare "$TMP/withwt.git"
git -C "$d" remote add origin "$TMP/withwt.git"
git -C "$d" branch -M main
git -C "$d" push -q -u origin main 2>/dev/null
git -C "$d" worktree add -q "$d/.claude/worktrees/feature" -b feat/x 2>/dev/null
echo work > "$d/.claude/worktrees/feature/file.txt"
git -C "$d/.claude/worktrees/feature" add -A
GIT_COMMITTER_DATE="$(date -d '9 days ago' -Iseconds)" \
  git -C "$d/.claude/worktrees/feature" -c user.email=t@t -c user.name=t \
  commit -qm "stranded in a worktree" --no-verify --date="$(date -d '9 days ago' -Iseconds)"

out="$(FLEET_ROOT="$wt_root" STRANDED_DAYS=3 bash "$SCRIPT" --check 2>&1)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"withwt/feature"* ]] \
  && ok "an aged commit inside a worktree is found, and named repo/worktree" \
  || no "worktree work must be reported (rc=$rc, out='$out')"

[[ "$out" == *"feat/x"* ]] \
  && ok "...and reports the worktree's own branch, not the parent's" \
  || no "expected the worktree branch feat/x (out='$out')"

# The main checkout must not be double-counted as one of its own worktrees.
[ "$(printf '%s\n' "$out" | grep -c 'withwt')" -eq 1 ] \
  && ok "the main checkout is not re-scanned as its own worktree" \
  || no "expected exactly one withwt line (out='$out')"

echo
echo "merged branches — the false positive that made the whole report noise:"

# On 2026-08-26 this guard named 25 stranded locations. Twenty-four of them were
# MERGED PRs (`gh pr list --state all`, all 24, oldest 25 days). The mechanism:
# the fleet squash-merges, GitHub deletes the remote branch, `fetch --prune`
# drops the tracking ref, and the local branch keeps a `branch.*.merge` config
# pointing at a ref that no longer resolves. The old code read that as "no
# upstream" and fell through to origin/main, where the pre-squash commit is
# unreachable by construction — so it counted as unpushed permanently.
#
# These three pin the distinction the fix turns on: upstream GONE is not
# upstream ABSENT.
mrepo="$TMP/merged"; mkdir -p "$mrepo"
git init -q --bare "$TMP/merged.git"
d="$(mkrepo_at "$TMP" merged)"
git -C "$d" remote add origin "$TMP/merged.git"
git -C "$d" branch -M main
git -C "$d" push -q -u origin main

git -C "$d" checkout -q -b feat/squashed
echo work > "$d/f.txt"; git -C "$d" add -A
GIT_COMMITTER_DATE="$(date -d '20 days ago' -Iseconds)" \
  git -C "$d" -c user.email=t@t -c user.name=t commit -qm "merged work" \
  --no-verify --date="$(date -d '20 days ago' -Iseconds)"
git -C "$d" push -q -u origin feat/squashed
# main gets the CONTENT under a different sha, exactly as a squash-merge does
git -C "$d" push -q origin --delete feat/squashed
git -C "$d" fetch -q --prune origin

git -C "$d" config --get branch.feat/squashed.merge >/dev/null \
  && ok "the fixture reproduces it: upstream still configured after the prune" \
  || no "fixture is wrong — upstream config should survive a prune"

line="$(scan_repo "$d")"
u="$(printf '%s' "$line" | cut -f4)"
[ "$u" = "0" ] \
  && ok "a pushed-then-deleted branch is not stranded — it already left the machine" \
  || no "merged branch must scan as 0 unpushed, got $u ('$line')"

# The other half: never pushed at all is still the worst case and must fire.
git -C "$d" checkout -q -b feat/never-pushed main
echo other > "$d/g.txt"; git -C "$d" add -A
GIT_COMMITTER_DATE="$(date -d '20 days ago' -Iseconds)" \
  git -C "$d" -c user.email=t@t -c user.name=t commit -qm "real stranded work" \
  --no-verify --date="$(date -d '20 days ago' -Iseconds)"
line="$(scan_repo "$d")"
u="$(printf '%s' "$line" | cut -f4)"; uage="$(printf '%s' "$line" | cut -f5)"
[ "$u" = "1" ] && [ "$uage" -ge 19 ] \
  && ok "a branch that never had an upstream still counts (${uage}d)" \
  || no "never-pushed work must still be found, got u=$u age=$uage"

# And a live upstream still measures against itself, not the default branch.
git -C "$d" push -q -u origin feat/never-pushed
echo more >> "$d/g.txt"; git -C "$d" add -A
GIT_COMMITTER_DATE="$(date -d '20 days ago' -Iseconds)" \
  git -C "$d" -c user.email=t@t -c user.name=t commit -qm "ahead of upstream" \
  --no-verify --date="$(date -d '20 days ago' -Iseconds)"
line="$(scan_repo "$d")"
u="$(printf '%s' "$line" | cut -f4)"
[ "$u" = "1" ] \
  && ok "a resolvable upstream is measured against, not origin/main" \
  || no "expected 1 commit ahead of upstream, got $u ('$line')"

echo
echo "end to end:"

out="$(FLEET_ROOT="$TMP" STRANDED_DAYS=3 bash "$SCRIPT" --check 2>&1)"; rc=$?
[ $rc -ne 0 ] && [[ "$out" == *"Stranded work"* ]] \
  && ok "--check exits non-zero and prints a header when the fleet is stranded" \
  || no "--check should have gone red (rc=$rc)"

clean_root="$TMP/onlyclean"; mkdir -p "$clean_root"
cp -r "$TMP/fresh" "$clean_root/fresh"
out="$(FLEET_ROOT="$clean_root" STRANDED_DAYS=3 bash "$SCRIPT" --check 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] \
  && ok "--check is silent and exits 0 on a healthy fleet" \
  || no "healthy fleet must print nothing (rc=$rc, out='$out')"

out="$(FLEET_ROOT="$TMP" bash "$SCRIPT" --nonsense 2>&1)"; rc=$?
[ $rc -eq 2 ] \
  && ok "an unknown argument fails loudly rather than defaulting to a pass" \
  || no "bad args should exit 2, got $rc"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
