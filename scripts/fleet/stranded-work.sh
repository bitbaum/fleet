#!/usr/bin/env bash
#
# Which repos are holding finished work that is going nowhere?
#
# This fleet already had `git-health` (in .bashrc), and it did not prevent the
# thing it looks like it prevents. On 2026-08-24 orangecat held 118 uncommitted
# files and fleetcrown 88, both untouched for ten days — a completed EntityType
# rename and a completed publishing workstream, existing on exactly one disk.
# `git-health` had been reporting "118 dirty" that whole time.
#
# That is the design error worth naming: DIRTY IS NOT A DEFECT. Every tree is
# dirty while someone is working in it. A number that is equally true at minute
# five and at day ten carries no signal, so it gets read as background noise and
# then not read at all.
#
#   AGE is the signal. Dirty for an hour is work. Dirty for a week is stranded.
#
# So this reports only what has aged past a threshold, and says NOTHING when the
# fleet is healthy. Silence-when-clean is not politeness, it is the mechanism:
# a check that prints on every shell gets muted, and a muted check is absent.
#
# It is also why this cannot be a CI job. The work it looks for has never left
# the machine — GitHub cannot see it by definition. It has to run where the
# uncommitted files are.
#
# Usage:
#   stranded-work.sh                 # report (silent when clean)
#   stranded-work.sh --check         # exit 1 if anything is stranded
#   stranded-work.sh --shell         # print cache, refresh in background; never blocks
#   stranded-work.sh --scan          # emit raw TSV, no verdict (feeds the tests)
#
# Env: FLEET_ROOT (default ~/dev), STRANDED_DAYS (default 3), STRANDED_CACHE

set -uo pipefail

ROOT="${FLEET_ROOT:-$HOME/dev}"
DAYS="${STRANDED_DAYS:-3}"
CACHE="${STRANDED_CACHE:-$HOME/.cache/fleet-stranded}"
CACHE_TTL_SEC="${STRANDED_CACHE_TTL:-14400}"   # 4h

MODE=report
case "${1:-}" in
  --check) MODE=check ;;
  --shell) MODE=shell ;;
  --scan)  MODE=scan ;;
  "")      MODE=report ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

now_epoch() { date +%s; }

# ---------------------------------------------------------------------------
# Scanning half — needs git and a filesystem.
# Emits TSV: name \t dirty_count \t dirty_age_days \t unpushed_count \t unpushed_age_days \t branch
# An age of -1 means "nothing of that kind", so the deciding half never has to
# distinguish absent from zero.
# ---------------------------------------------------------------------------
scan_repo() {
  local dir="$1" name branch now
  # Optional $2 overrides the display name, so a worktree can report as
  # "repo/branch-dir" instead of a bare directory name that says nothing about
  # which repo it belongs to.
  name="${2:-$(basename "$dir")}"
  now="$(now_epoch)"

  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

  local dirty_count=0 oldest_mtime="" dirty_age=-1
  local line path
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    dirty_count=$((dirty_count + 1))
    # Porcelain is "XY path". Strip the 2-char status and its space FIRST, then
    # resolve renames ("R  old -> new") to the path that still exists. Doing it
    # the other way round eats three characters of the new filename.
    path="${line:3}"
    path="${path##* -> }"
    [ -e "$dir/$path" ] || continue          # deletions have no mtime to read
    local m
    m="$(stat -c %Y "$dir/$path" 2>/dev/null)" || continue
    if [ -z "$oldest_mtime" ] || [ "$m" -lt "$oldest_mtime" ]; then oldest_mtime="$m"; fi
  done < <(git -C "$dir" status --porcelain 2>/dev/null)

  if [ -n "$oldest_mtime" ]; then
    dirty_age=$(( (now - oldest_mtime) / 86400 ))
  fi

  # Unpushed: measured against the upstream when there is one, else against the
  # remote default branch. A branch that was never pushed is the worse case, not
  # an exempt one — that is where four of fleetcrown's commits were hiding.
  #
  # But "no upstream" and "upstream gone" are opposite facts, and conflating
  # them made this guard report the whole fleet as stranded. The fleet's normal
  # end of life for a branch is: push, PR, squash-merge, GitHub deletes the
  # remote branch, a later `fetch --prune` drops the tracking ref. The local
  # branch is left with `branch.<n>.merge` still configured and nothing to
  # resolve it to. Falling through to origin/main then counts the pre-squash
  # commit as unpushed FOREVER — it is not reachable from main and never will
  # be, because main got a different commit with the same content.
  #
  # Measured 2026-08-26: 24 of the 25 locations this reported as stranded were
  # merged PRs. Every one. `gh pr list --state all` said MERGED for all 24, the
  # oldest 25 days — i.e. the guard's loudest number was entirely false, and it
  # would have stayed false for as long as those worktrees existed.
  #
  # A configured-but-unresolvable upstream is therefore proof the branch DID
  # leave the machine, which is exactly what puts it out of scope: this guard
  # looks for work GitHub cannot see. Whether that pushed branch was merged or
  # abandoned is a question for `gh`, not for a filesystem scan.
  local base unpushed_count=0 unpushed_age=-1 oldest_commit upstream
  upstream="$(git -C "$dir" for-each-ref --format='%(upstream:short)' \
    "refs/heads/$branch" 2>/dev/null)"
  if [ -n "$upstream" ]; then
    if git -C "$dir" rev-parse --verify -q "refs/remotes/$upstream" >/dev/null 2>&1; then
      base="$upstream"
    else
      base=''          # pushed, then the remote branch was deleted — not stranded
    fi
  elif git -C "$dir" rev-parse --verify -q origin/main >/dev/null 2>&1; then
    base='origin/main'
  elif git -C "$dir" rev-parse --verify -q origin/master >/dev/null 2>&1; then
    base='origin/master'
  else
    base=''
  fi

  if [ -n "$base" ]; then
    unpushed_count="$(git -C "$dir" rev-list --count "$base"..HEAD 2>/dev/null || echo 0)"
    if [ "${unpushed_count:-0}" -gt 0 ]; then
      oldest_commit="$(git -C "$dir" log "$base"..HEAD --format=%ct 2>/dev/null | tail -1)"
      [ -n "$oldest_commit" ] && unpushed_age=$(( (now - oldest_commit) / 86400 ))
    fi
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$name" "$dirty_count" "$dirty_age" "${unpushed_count:-0}" "$unpushed_age" "$branch"
}

# Worktrees hold real branches, and this guard could not see them.
#
# Measured 2026-08-25 in fleetcrown alone: 9 agent worktrees under
# .claude/worktrees/ held 13 commits across 9 branches, NONE of them pushed,
# the oldest 3 weeks old — while `fleet-stranded` reported the fleet clean.
# The loop below only ever looked at $ROOT/*/, so every branch created by
# `_claude_autoworktree_enter` was invisible to the one check built to find
# exactly this. A guard with a blind spot shaped like the fleet's dominant
# workflow is worse than none: it certifies the thing it cannot see.
#
# `git worktree list --porcelain` reports the main checkout first; skip it,
# since the loop already scanned it.
scan_worktrees() {
  local repo="$1" repo_name="$2" first=1 wt
  while IFS= read -r wt; do
    if [ "$first" -eq 1 ]; then first=0; continue; fi   # main checkout
    [ -e "$wt" ] || continue
    scan_repo "$wt" "${repo_name}/$(basename "$wt")"
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')
}

scan_all() {
  local d name
  for d in "$ROOT"/*/; do
    [ -d "$d/.git" ] || continue
    d="${d%/}"
    name="$(basename "$d")"
    scan_repo "$d" "$name"
    scan_worktrees "$d" "$name"
  done
}

# ---------------------------------------------------------------------------
# Deciding half — pure text. No git, no filesystem, no clock.
#
# Kept separate for the same reason shared-inventory.sh splits counting from
# ratcheting: a rule you can only exercise by aging a real repo three days is a
# rule nobody re-tests after editing it.
#
# Reads TSV on stdin. Prints one line per stranded repo. Returns 1 if any.
# ---------------------------------------------------------------------------
decide() {
  local threshold="$1" found=0
  local name dirty dirty_age unpushed unpushed_age branch
  while IFS=$'\t' read -r name dirty dirty_age unpushed unpushed_age branch; do
    [ -n "$name" ] || continue
    local why=""
    if [ "$dirty" -gt 0 ] && [ "$dirty_age" -ge "$threshold" ]; then
      why="${dirty} uncommitted, oldest ${dirty_age}d"
    fi
    if [ "$unpushed" -gt 0 ] && [ "$unpushed_age" -ge "$threshold" ]; then
      [ -n "$why" ] && why="${why}; "
      why="${why}${unpushed} unpushed, oldest ${unpushed_age}d"
    fi
    [ -n "$why" ] || continue
    printf '  %-20s %s (%s)\n' "$name" "$why" "$branch"
    found=1
  done
  return $((found == 0 ? 0 : 1))
}

render() {
  local body
  body="$(scan_all | decide "$DAYS")"
  local rc=$?
  if [ $rc -ne 0 ]; then
    printf 'Stranded work — finished but going nowhere (>%sd):\n%s\n' "$DAYS" "$body"
  fi
  return $rc
}

# The tests source this file to drive decide() and scan_repo() directly, so what
# they exercise is the shipped rule rather than a restatement of it that can
# quietly drift away from the one actually running.
if [ -n "${STRANDED_LIB_ONLY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

case "$MODE" in
  scan)
    scan_all
    ;;
  report)
    render
    exit 0
    ;;
  check)
    render
    exit $?
    ;;
  shell)
    # Never block a shell. Print what we knew as of the last scan, then refresh
    # in the background if that knowledge is stale. A guard that costs three
    # seconds of every prompt is a guard that gets deleted.
    mkdir -p "$(dirname "$CACHE")"
    [ -s "$CACHE" ] && cat "$CACHE"
    stale=1
    if [ -f "$CACHE" ]; then
      age=$(( $(now_epoch) - $(stat -c %Y "$CACHE" 2>/dev/null || echo 0) ))
      [ "$age" -lt "$CACHE_TTL_SEC" ] && stale=0
    fi
    if [ "$stale" -eq 1 ]; then
      ( render > "$CACHE.tmp" 2>/dev/null; mv -f "$CACHE.tmp" "$CACHE" 2>/dev/null ) \
        >/dev/null 2>&1 &
      disown 2>/dev/null || true
    fi
    exit 0
    ;;
esac
