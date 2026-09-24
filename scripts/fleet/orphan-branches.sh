#!/usr/bin/env bash
#
# Local branches that exist ONLY on this disk.
#
# `stranded-work.sh` examines each checkout's CURRENT branch. A branch that was
# never pushed and is not checked out is invisible to it — which is precisely
# the work GitHub cannot see, i.e. the thing that guard exists to find.
#
# Measured 2026-09-12, first run: 243 such branches across 24 repos, 564
# commits. Most are old and superseded. Some were not: a 1.1 GB clone nested
# inside loki looked entirely redundant — clean tree, nothing unpushed on
# its checked-out branch — and held three commits from the previous day on a
# DIFFERENT branch, with no remote ref. It was one `rm -rf` from gone.
#
#   A clean tree is a statement about one branch. It says nothing about the
#   other forty in the same repository.
#
# Why all three filters are needed before calling a branch orphaned:
#
#   * commits absent from the default branch — `git cherry` compares patch ids
#   * no remote-tracking ref — it never left the machine
#   * no PR was ever opened from it — `cherry` cannot see a squash-merge, which
#     rewrites several commits into one with a different patch id, so a merged
#     branch scores "absent" forever. Without this filter the report is mostly
#     branches that shipped weeks ago. Note the converse is not covered: a PR
#     opened from a DIFFERENT branch name still reads as orphaned here, so the
#     count is an upper bound. It is a list to look at, not a verdict.
#
# Usage:
#   orphan-branches.sh                 # report every orphan (silent when none)
#   orphan-branches.sh --days N        # only those touched in the last N days
#   orphan-branches.sh --days N --push # push those, no PR: preserves, ships nothing
#
# Env: FLEET_ROOT (default ~/dev)

set -uo pipefail

ROOT="${FLEET_ROOT:-$HOME/dev}"
DAYS=0
PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="${2:-0}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$PUSH" -eq 1 ] && [ "$DAYS" -eq 0 ] && {
  echo "--push requires --days: pushing every orphan puts hundreds of stale refs on the remotes" >&2
  exit 2
}

CUTOFF=0
[ "$DAYS" -gt 0 ] && CUTOFF=$(( $(date +%s) - DAYS*86400 ))

# Branches created by the stranded-work tests. Publishing a fixture is how a
# pre-push hook once force-pushed test data over main.
is_fixture() {
  case "$1" in stale|other|main|master) return 0 ;; *) return 1 ;; esac
}

found=0
for repo in "$ROOT"/*/; do
  [ -e "$repo/.git" ] || continue
  name="$(basename "$repo")"
  slug="$(git -C "$repo" remote get-url origin 2>/dev/null \
        | sed -E 's#.*[:/]([^/]+/[^/]+?)(\.git)?$#\1#')"
  [ -n "$slug" ] || continue

  base=origin/main
  git -C "$repo" rev-parse --verify -q "$base" >/dev/null 2>&1 || base=origin/master
  git -C "$repo" rev-parse --verify -q "$base" >/dev/null 2>&1 || continue

  prs="$(gh pr list --repo "$slug" --state all --limit 1000 --json headRefName \
         --jq '.[].headRefName' 2>/dev/null | sort -u)"

  body=""
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    is_fixture "$b" && continue
    n="$(git -C "$repo" cherry "$base" "$b" 2>/dev/null | grep -c '^+')"
    [ "$n" -gt 0 ] || continue
    git -C "$repo" rev-parse --verify -q "refs/remotes/origin/$b" >/dev/null 2>&1 && continue
    grep -qxF "$b" <<<"$prs" && continue

    when="$(git -C "$repo" log -1 --format=%ct "$b" 2>/dev/null)"
    [ -n "$when" ] || continue
    [ "$CUTOFF" -gt 0 ] && [ "$when" -lt "$CUTOFF" ] && continue

    if [ "$PUSH" -eq 1 ]; then
      if git -C "$repo" push --no-verify -q origin "refs/heads/$b:refs/heads/$b" 2>/dev/null; then
        body="${body}    $(printf '%-44s pushed' "$b")\n"
      else
        body="${body}    $(printf '%-44s PUSH FAILED' "$b")\n"
      fi
    else
      body="${body}    $(printf '%-44s %2s commit(s)  last %s' \
            "$b" "$n" "$(git -C "$repo" log -1 --format=%cr "$b")")\n"
    fi
    found=$((found + 1))
  done < <(git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads)

  [ -n "$body" ] && { printf '%s (%s):\n' "$name" "$slug"; printf "$body"; }
done

# Silence when clean, for the same reason stranded-work.sh is silent: a check
# that prints on every run gets muted, and a muted check is an absent one.
[ "$found" -eq 0 ] && exit 0
exit 0
