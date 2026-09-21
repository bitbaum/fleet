#!/usr/bin/env bash
# A workflow that COMMITS TO THIS REPO'S MAIN must re-arm CI, or it stalls the
# merge queue.
#
# WHY THE INVARIANT EXISTS
#
# A push made with GITHUB_TOKEN triggers no workflows, so main gets no CI run
# for that commit and the auto-merge sweep refuses everything with "main is at
# <tip> but the newest CI run is for <older>" until a human dispatches CI by
# hand — which nothing tells them to do. Hit four times in two days (readings,
# then origin proof) before it was named, each time silently holding every open
# PR in the repo.
#
# WHY IT IS A SCRIPT NOW
#
# It was six inline lines in ci.yml keyed on `grep -q 'git push'`, which is
# coarser than the invariant its own name states. On 2026-09-21 that gap
# produced its first false positive: `internal-currency.yml` pushes a FEATURE
# branch to a DIFFERENT repository using a PAT — three independent reasons it
# cannot strand this repo's merge queue — and the gate demanded it dispatch
# fleet's own CI, which would have been a meaningless dispatch added purely to
# satisfy a grep.
#
# The gate was not wrong. It indexed more than it was trusted to cover, which
# is this file's recurring shape. The fix is the one this repo keeps arriving
# at: narrow the predicate to the invariant, and move it somewhere fixtures can
# reach it. A rule that can only be exercised by editing a real workflow is a
# rule nobody re-tests after changing its regex — the same reasoning that put
# the verify-contract rules in `verify-predicates.sh`.
#
# WHAT COUNTS AS PUSHING TO MAIN
#
#   bare `git push`              → the CURRENT branch. On a scheduled run here
#                                  that is main. COUNTS.
#   `git push origin main`       → says so. COUNTS.
#   `git push origin HEAD:main`  → same. COUNTS.
#   `git push origin "$BRANCH"`  → an explicit ref that is not main, UNLESS the
#                                  file assigns that variable to main. Does not
#                                  count.
#
# The variable check is what keeps the exemption from being a doorway: naming
# your push target `$BRANCH` must not buy an exemption when `BRANCH: main` sits
# ten lines above it.
#
# WHAT IT STILL DOES NOT COVER, said plainly rather than implied
#
# A workflow that pushes to ANOTHER repository's default branch. That cannot
# strand THIS repo's queue, which is the invariant here, and a gate for it
# belongs with whatever owns that repo's queue. Stated so the next reader knows
# the silence is a boundary and not a pass.
#
#   bash scripts/ci/check-rearm.sh [workflow-dir]     (default .github/workflows)
set -euo pipefail

dir="${1:-.github/workflows}"

# Is this `git push` line targeting the current branch or main?
push_targets_main() {
  local line="$1" file="$2" rest token var

  rest="${line#*git push}"
  # Drop flags: --force-with-lease, --force, -u, --tags, --follow-tags, -q …
  rest="$(printf '%s' "$rest" | sed -E 's/(^|[[:space:]])-{1,2}[A-Za-z][A-Za-z-]*(=[^[:space:]]*)?//g')"
  # Drop shell noise that can trail a command inside a run: block.
  rest="$(printf '%s' "$rest" | sed -E 's/[;&|].*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"

  # Nothing left: a bare push, which sends the CURRENT branch.
  [ -z "$rest" ] && return 0

  for token in $rest; do
    token="${token%\"}"
    token="${token#\"}"
    # `HEAD:main`, `refs/heads/main`, or plain `main`.
    case "${token##*:}" in
      main | master | refs/heads/main | refs/heads/master) return 0 ;;
    esac
    case "$token" in
      refs/heads/main | refs/heads/master) return 0 ;;
    esac

    # A variable target is exempt only if the file never sets it to main.
    # `"$BRANCH"` / `$BRANCH` / `${BRANCH}` all reduce to BRANCH.
    case "$token" in
      \$*)
        var="${token#\$}"
        var="${var#\{}"
        var="${var%\}}"
        if grep -qE "(^|[[:space:]])${var}[:=][[:space:]]*[\"']?(main|master)[\"']?([[:space:]]|$)" "$file"; then
          return 0
        fi
        ;;
    esac
  done
  return 1
}

bad=0
checked=0
exempt=0

for f in "$dir"/*.yml; do
  [ -e "$f" ] || continue
  grep -q 'git push' "$f" || continue

  targets_main=1
  real_pushes=0
  while IFS= read -r line; do
    case "$line" in
    *'git push'*) ;;
    *) continue ;;
    esac
    # A COMMENT is not a push, in YAML or in the shell inside a `run:` block.
    # Without this the gate reports itself: ci.yml quotes this very predicate
    # in the comment explaining it, and was listed as a pushing workflow.
    case "${line#"${line%%[![:space:]]*}"}" in
    '#'*) continue ;;
    esac
    real_pushes=$((real_pushes + 1))
    if push_targets_main "$line" "$f"; then
      targets_main=0
      break
    fi
  done <"$f"

  # Every `git push` in the file was a comment. Not a pushing workflow at all,
  # so it is not reported as one — "pushes, but never to main" would be a
  # sentence about a workflow that does not push.
  [ "$real_pushes" -eq 0 ] && continue

  if [ "$targets_main" -ne 0 ]; then
    exempt=$((exempt + 1))
    echo "  · ${f##*/} pushes, but never to this repo's main — re-arm not required"
    continue
  fi

  checked=$((checked + 1))
  if ! grep -q 'gh workflow run ci.yml' "$f"; then
    echo "✗ ${f##*/} pushes to main but never re-arms CI — it will stall the merge queue" >&2
    bad=1
  fi
  if ! grep -q 'actions: write' "$f"; then
    echo "✗ ${f##*/} re-arms CI but lacks 'actions: write' — the dispatch will be refused" >&2
    bad=1
  fi
done

# A predicate that matches nothing passes exactly as quietly as one that works.
# The three main-pushing workflows are the floor; if they vanish, say so.
if [ "$checked" -eq 0 ]; then
  echo "no main-pushing workflows found in $dir — did they move, or did the predicate stop matching?" >&2
  exit 1
fi

[ "$bad" -eq 0 ] || exit 1
echo "pushers re-arm CI: ok ($checked checked, $exempt exempt)"
