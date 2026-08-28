#!/usr/bin/env bash
#
# Remove the worktrees whose work already shipped.
#
# The fleet works almost entirely in per-session `git worktree` checkouts. They
# are created automatically and removed by nobody, so they accumulate: on
# 2026-08-26 there were 24 of them holding 5.2 GB, and every single one belonged
# to a PR that had already merged. Twenty-three were byte-for-byte clean.
#
# That is a recurring manual sweep, which is the definition of something that
# should be a committed script rather than a thing an agent re-derives. But a
# script that deletes checkouts has to be paranoid, so the whole design is the
# four-part predicate in safe_to_remove(): a worktree is removable only if it
# was PUSHED, is CLEAN, is UNUSED, and GitHub says MERGED.
#
# Dry-run is the default. Nothing is deleted without `--go`.
#
# Usage:
#   gc-merged-worktrees.sh          # show what would go (default)
#   gc-merged-worktrees.sh --go     # actually remove
#
# Env: FLEET_ROOT (default ~/dev), SESSIONS_DIR (default ~/.claude/sessions)

set -uo pipefail

ROOT="${FLEET_ROOT:-$HOME/dev}"
SESSIONS_DIR="${SESSIONS_DIR:-$HOME/.claude/sessions}"

GO=0
case "${1:-}" in
  --go) GO=1 ;;
  --dry|"") GO=0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# The predicate. Pure except for the four facts it is handed, so the tests can
# drive every branch without building a GitHub repo or a live agent session.
#
# Echoes "ok" or the reason it refused. Returns 0 only for "ok".
#
#   pushed   : "yes" if the branch has an upstream configured. A branch with no
#              upstream never left the machine — removing it destroys the only
#              copy. This is the one that must never be loosened.
#   dirty_n  : count of uncommitted files. Any is a refusal; a worktree is
#              exactly where someone's unfinished edit lives.
#   in_use   : "yes" if a live session's cwd is inside it.
#   pr_state : whatever `gh pr list --state all` said, or "" if it said nothing.
#              MERGED is required — CLOSED means abandoned, and abandoned work
#              is still a decision someone might want to revisit.
# ---------------------------------------------------------------------------
safe_to_remove() { # <pushed> <dirty_n> <in_use> <pr_state>
  local pushed="$1" dirty_n="$2" in_use="$3" pr_state="$4"
  if [ "$pushed" != yes ];  then echo "never pushed — this is the only copy"; return 1; fi
  if [ "${dirty_n:-0}" -ne 0 ]; then echo "$dirty_n uncommitted file(s)";     return 1; fi
  if [ "$in_use" = yes ];   then echo "a live session is in it";              return 1; fi
  if [ "$pr_state" != MERGED ]; then echo "PR state '${pr_state:-none}', not MERGED"; return 1; fi
  echo ok
}

if [ -n "${GC_WORKTREES_LIB_ONLY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

# ---------------------------------------------------------------------------
live_cwds() {
  # A session that is inside a worktree is the case worth being careful about;
  # missing registry files simply mean no sessions, not an error.
  jq -r 'select(.status!=null) | .cwd' "$SESSIONS_DIR"/*.json 2>/dev/null | sort -u
}

LIVE="$(live_cwds)"
removed=0 skipped=0 freed=0

for repo in "$ROOT"/*/; do
  repo="${repo%/}"; [ -d "$repo/.git" ] || continue
  slug="$(git -C "$repo" remote get-url origin 2>/dev/null \
          | sed -E 's#.*github.com[:/]##; s#\.git$##')" || continue
  [ -n "$slug" ] || continue

  # `worktree list` reports the main checkout first — never a candidate.
  while read -r wt; do
    [ -n "$wt" ] && [ -e "$wt" ] || continue
    branch="$(git -C "$wt" symbolic-ref --quiet --short HEAD)" || continue

    # "Pushed" means an upstream is CONFIGURED, not that it still resolves.
    # After a squash-merge GitHub deletes the remote branch and `fetch --prune`
    # drops the tracking ref, leaving branch.<n>.merge pointing at nothing — so
    # a resolvable upstream means the branch is still open, and an unresolvable
    # one is the signal we are looking for. (Same distinction stranded-work.sh
    # turns on; getting it backwards there reported 24 merged PRs as stranded.)
    upstream="$(git -C "$wt" for-each-ref --format='%(upstream:short)' "refs/heads/$branch")"
    [ -n "$upstream" ] && pushed=yes || pushed=no
    if [ "$pushed" = yes ] && \
       git -C "$wt" rev-parse --verify -q "refs/remotes/$upstream" >/dev/null 2>&1; then
      continue   # remote branch still exists — the PR is open, leave it alone
    fi

    dirty_n="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l)"
    printf '%s\n' "$LIVE" | grep -qxF "$wt" && in_use=yes || in_use=no

    pr_state=""
    if [ "$pushed" = yes ] && [ "$dirty_n" -eq 0 ] && [ "$in_use" = no ]; then
      # Only ask GitHub once the cheap local checks have passed — this is the
      # only network call, and it is the authority, re-asked at removal time
      # rather than trusted from an earlier scan.
      pr_state="$(gh pr list -R "$slug" --head "$branch" --state all \
                  --json state --jq '.[0].state' 2>/dev/null)"
    fi

    reason="$(safe_to_remove "$pushed" "$dirty_n" "$in_use" "$pr_state")"
    if [ "$reason" != ok ]; then
      printf 'keep    %-52s %s\n' "${wt#"$ROOT"/}" "$reason"
      skipped=$((skipped + 1))
      continue
    fi

    mb="$(du -sm "$wt" 2>/dev/null | cut -f1)"
    if [ "$GO" -eq 1 ]; then
      if git -C "$repo" worktree remove --force "$wt" 2>/dev/null; then
        git -C "$repo" branch -D "$branch" >/dev/null 2>&1
        printf 'removed %-52s %sMB  (%s)\n' "${wt#"$ROOT"/}" "$mb" "$branch"
        removed=$((removed + 1)); freed=$((freed + mb))
      else
        printf 'FAILED  %-52s could not remove\n' "${wt#"$ROOT"/}"
        skipped=$((skipped + 1))
      fi
    else
      printf 'would   %-52s %sMB  (%s)\n' "${wt#"$ROOT"/}" "$mb" "$branch"
      removed=$((removed + 1)); freed=$((freed + mb))
    fi
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null \
           | awk '/^worktree /{print $2}' | tail -n +2)
done

echo "---"
if [ "$GO" -eq 1 ]; then
  echo "removed $removed worktrees, ${freed}MB freed; $skipped kept"
else
  echo "$removed removable (${freed}MB), $skipped kept — rerun with --go to remove"
fi
