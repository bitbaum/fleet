#!/usr/bin/env bash
#
# What has the fleet built more than once — and is it getting better or worse?
#
# The problem this solves is not "we don't know we duplicate things". Everyone
# knows. The problem is that knowing has never changed the number:
#
#   - orangecat's ADR-0002 ("Unify Rate Limiting Modules", 2026-01-18) is still
#     Status: Proposed. It names TWO implementations. There are now FOUR.
#   - templates/ci/README.md says "deliberately ONE central script, not a copy
#     per repo". auto-merge-sweep.sh exists in 21 repos in 8 distinct versions,
#     11,787 to 19,344 bytes. A fix in one reaches at most 9 of them.
#
# Both were written down. Writing it down is what failed. So this does not
# produce a document — it produces a NUMBER, and `--check` makes that number a
# ratchet: it may fall, it may hold, it may never rise. That is the whole
# mechanism. Nobody has to fix everything today; they only have to stop adding.
#
# Reads each repo's REMOTE default branch via the trees API, never a local
# checkout: clones drift, and a stale clone has already produced a redundant PR
# and a nearly-dropped gate in this fleet.
#
# Usage:
#   shared-inventory.sh                 # report
#   shared-inventory.sh --check         # ratchet: exit 1 if any count ROSE
#   shared-inventory.sh --update        # rewrite the baseline (do this in a PR)
#
# Env: GH_OWNER (default bitbaum), GH_LIMIT (default 100)

set -uo pipefail

OWNER="${GH_OWNER:-bitbaum}"
LIMIT="${GH_LIMIT:-100}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASELINE="${SHARED_INVENTORY_BASELINE:-$HERE/shared-inventory.baseline}"

MODE=report
case "${1:-}" in
  --check)  MODE=check ;;
  --update) MODE=update ;;
  "")       MODE=report ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 2; }

# ── The concerns we track ────────────────────────────────────────────────────
#
# Each line: name|regex over file paths. Deliberately conservative — a concern
# belongs here only if a shared implementation is PLAUSIBLE. Auth, DB schemas
# and UI markup are excluded on purpose: they are coupled to a framework, a
# schema, or a design system, and "centralize everything" is how apps stop being
# able to look or behave like themselves.
CONCERNS='
automerge-script|scripts/ci/auto-merge-sweep\.sh$
rate-limit|(lib|src|app|apps|packages)/.*rate-?limit(er)?\.(ts|js)$
email-send|(lib|src)/.*(email|mailer|resend)/(index|client|send|config)\.(ts|js)$
logger|(lib|src)/.*logger\.(ts|js)$
api-envelope|(lib|src)/.*(route-helpers|api-response|apiResponse)\.(ts|js)$
health-route|.*api/health/route\.(ts|js)$
slug-util|(lib|src)/.*slug(ify)?\.(ts|js)$
date-utils|(lib|src)/.*(dates|date-utils)\.(ts|js)$
ai-provider-client|(lib|src|packages|apps)/.*(provider|call-provider)s?\.(ts|js)$
'

# ── Collect ──────────────────────────────────────────────────────────────────
#
# FORKS ARE EXCLUDED, and that exclusion is load-bearing. `openclaw` is a fork of
# openclaw/openclaw (1.5 GB of upstream), and counting it put 46 provider files,
# 7 loggers and 7 date utils into the totals — none of them written here, none
# of them ours to unify. A metric dominated by somebody else's codebase measures
# nothing and gets ignored, which is the failure mode every check in this repo
# exists to avoid.
repos=$(gh repo list "$OWNER" --limit "$LIMIT" --no-archived --source \
          --json name,defaultBranchRef \
          --jq '.[] | "\(.name)\t\(.defaultBranchRef.name // "")"' 2>/dev/null)
[ -n "$repos" ] || { echo "could not list repos for $OWNER" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
truncated=""
inspected=0

while IFS=$'\t' read -r name branch; do
  [ -n "$name" ] || continue
  [ -n "$branch" ] || continue
  body=$(gh api "repos/$OWNER/$name/git/trees/$branch?recursive=1" 2>/dev/null) || continue
  [ -n "$body" ] || continue
  # A truncated tree UNDERCOUNTS, which would read as progress. Say so.
  if [ "$(printf '%s' "$body" | jq -r '.truncated // false')" = "true" ]; then
    truncated="$truncated $name"
  fi
  printf '%s' "$body" \
    | jq -r '.tree[]? | select(.type=="blob") | .path' 2>/dev/null \
    | grep -viE 'node_modules|\.next/|/dist/|__tests__|\.test\.|\.spec\.|\.d\.ts' \
    > "$TMP/$name.files"
  inspected=$((inspected + 1))
done <<< "$repos"

# ── Count ────────────────────────────────────────────────────────────────────
current="$TMP/current"
: > "$current"

for line in $CONCERNS; do
  [ -n "$line" ] || continue
  concern="${line%%|*}"
  re="${line#*|}"
  repos_with=0
  copies=0
  who=""
  for f in "$TMP"/*.files; do
    [ -e "$f" ] || continue
    r="$(basename "$f" .files)"
    n=$(grep -icE "$re" "$f" 2>/dev/null || true)
    n=${n:-0}
    if [ "$n" -gt 0 ]; then
      repos_with=$((repos_with + 1))
      copies=$((copies + n))
      who="$who $r($n)"
    fi
  done
  printf '%s\t%s\t%s\n' "$concern" "$repos_with" "$copies" >> "$current"
  if [ "$MODE" = report ]; then
    printf '%-20s %2d repos  %3d files %s\n' "$concern" "$repos_with" "$copies" \
      "$(echo "$who" | cut -c1-80)"
  fi
done

if [ "$MODE" = report ]; then
  echo
  echo "inspected $inspected repo(s) on their default branches"
  [ -n "$truncated" ] && echo "⚠ TRUNCATED trees (undercounted):$truncated"
  echo
  echo "A count is not a verdict — see SHARED.md for what is worth extracting."
  exit 0
fi

if [ "$MODE" = update ]; then
  cp "$current" "$BASELINE"
  echo "baseline written: $BASELINE"
  cat "$BASELINE"
  exit 0
fi

# ── Ratchet ──────────────────────────────────────────────────────────────────
[ -f "$BASELINE" ] || { echo "no baseline at $BASELINE — run --update" >&2; exit 2; }

# A truncated tree undercounts, so a "pass" here could be an artefact. Refuse to
# certify rather than report a decrease that did not happen.
if [ -n "$truncated" ]; then
  echo "✗ tree truncated for:$truncated — counts undercount, refusing to judge" >&2
  exit 2
fi

fail=0
while IFS=$'\t' read -r concern was_repos was_copies; do
  [ -n "$concern" ] || continue
  now_line=$(grep -P "^${concern}\t" "$current" 2>/dev/null || grep "^${concern}	" "$current" 2>/dev/null)
  if [ -z "$now_line" ]; then
    echo "· $concern — no longer measured (concern removed from the script?)"
    continue
  fi
  now_copies=$(printf '%s' "$now_line" | cut -f3)
  if [ "$now_copies" -gt "$was_copies" ]; then
    echo "✗ $concern: $was_copies → $now_copies files. The ratchet only turns one way."
    fail=1
  elif [ "$now_copies" -lt "$was_copies" ]; then
    echo "✓ $concern: $was_copies → $now_copies files — run --update to lock it in."
  fi
done < "$BASELINE"

# A concern present now but absent from the baseline is new duplication that
# would otherwise slip in unmeasured.
while IFS=$'\t' read -r concern _ now_copies; do
  [ -n "$concern" ] || continue
  if ! cut -f1 "$BASELINE" | grep -qx "$concern"; then
    echo "✗ $concern: not in the baseline ($now_copies files). Add it deliberately with --update."
    fail=1
  fi
done < "$current"

if [ "$fail" -ne 0 ]; then
  echo
  echo "Duplication rose. Either reuse what exists (SHARED.md) or, if this copy is"
  echo "genuinely justified, run --update in the same PR so the increase is reviewed."
  exit 1
fi

echo "✓ duplication did not increase (inspected $inspected repos)"
