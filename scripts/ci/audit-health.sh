#!/usr/bin/env bash
# Fleet audit: are the AUDITS themselves running, recent, and able to look?
#
# Every other script in this directory gates the fleet. Nothing gated them.
# Measured 2026-09-17, four of the twenty-one were not doing their job and
# nothing anywhere said so:
#
#   email-canary        RED that day     — a real finding (the Resend sender
#                                          domain for every app read unverified)
#                                          sitting unattended
#   bus-factor          RED for 2 days   — passes locally; not reproducible
#   dependabot-alerts   RED for 3 days   — passes locally
#   hosted-supabase     CANCELLED        — so it audited NOTHING for 3 days,
#                                          and said nothing about that
#
# templates/ci/README.md, Rung 4: a gate that runs, reports success and means
# nothing is worse than no gate, because it produces a ✓. A gate that runs,
# reports FAILURE and is never read is the same defect wearing the other
# colour — the signal exists and reaches nobody. And a cancelled audit is the
# purest form of it: it did not look, and its silence is indistinguishable
# from a clean sweep.
#
# So this asks three questions of every audit workflow in this repo:
#
#   1. Has it ever run?           (a workflow GitHub refused parses as "no runs"
#                                  — see the dotfiles duplicate-key incident)
#   2. Was its last run green?    (cancelled and timed-out count as NOT green:
#                                  an audit that stopped early audited nothing)
#   3. Did it run recently enough for its OWN schedule?
#
# ...and then one question about whether they can look at all:
#
#   4. Does every `secrets.NAME` a workflow references actually EXIST?
#
# Four is here rather than in its own script because a phantom secret is the
# mechanism by which an audit lies: `${{ secrets.ABSENT || secrets.GITHUB_TOKEN }}`
# is not an error, it silently degrades to the repo-scoped default token, and
# an audit that sweeps the fleet with a token that can only see ONE repo
# reports a clean fleet. That is what was happening here: FLEET_READ_TOKEN and
# FLEET_ADMIN_TOKEN are referenced by seven workflows and have never existed.
#
# THE STALENESS THRESHOLD IS DERIVED, NOT CONFIGURED.
#
# Each workflow already declares its cadence in its own `cron:`. Reading a
# second copy of it from a table here would be Ground Truth #2 violated by the
# script that exists to enforce it — and the table would drift the first time
# someone changed a schedule. The threshold is therefore computed from the
# file: roughly two missed runs plus a grace, so a single skipped tick (a
# runner outage, a rate limit) is not a page, and a workflow that has quietly
# stopped firing is.
#
# A read that FAILS is not a finding. Same rule as verify-predicates.sh: the
# fleet has already shipped one audit that turned an outage into four wrong
# verdicts by reading `2>/dev/null` output as fact. Here an unreadable run
# listing is reported as UNREADABLE and withheld from the verdict.

set -uo pipefail

OWNER="${OWNER:-bitbaum}"
REPO="${REPO:-fleet}"
MODE="report"
case "${1:-}" in
  --check) MODE="check" ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

# Workflows that are not audits. Each needs a reason, because "it was noisy"
# is how a real gate gets exempted and never comes back.
is_not_an_audit() {
  case "$1" in
    # The repo's own CI — covered by the floor like every other repo's.
    ci.yml) return 0 ;;
    # Merge plumbing, not a fleet audit: it runs per-merge and a no-op sweep
    # exiting 0 on an empty queue is its correct, constant state.
    auto-merge.yml|auto-merge-sweep.yml) return 0 ;;
    # Reconcilers ACT on drift rather than reporting it; they run many times a
    # day and their health is already visible as the deploy-freshness verdict.
    deploy-reconciler.yml) return 0 ;;
    # This script's own workflow: it is the thing doing the looking.
    audit-health.yml) return 0 ;;
    *) return 1 ;;
  esac
}

# 0 = fetched, 1 = could not look, 2 = genuinely absent.
gh_json() {
  local out rc
  out=$(gh api "$1" 2>/dev/null); rc=$?
  if [ $rc -ne 0 ]; then
    # A 404 is an answer. Anything else is a failure to look.
    if gh api "$1" 2>&1 | grep -q '(HTTP 404)'; then return 2; fi
    return 1
  fi
  printf '%s' "$out"; return 0
}

# Seconds a workflow may go quiet before it is STALE, derived from its cron.
# Two missed ticks plus a grace: a single skipped run is weather, two is a
# workflow that has stopped.
threshold_for() {
  local file="$1" cron dom dow hour
  cron=$(grep -oE "^[[:space:]]*-[[:space:]]*cron:[[:space:]]*['\"][^'\"]+['\"]" "$file" 2>/dev/null \
         | head -1 | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/")
  [ -z "$cron" ] && { echo 0; return; }      # dispatch-only: no cadence to miss
  # Split with `read`, NOT `set -- $cron`. Word-splitting a cron expression
  # also GLOBS it: the `*` fields expand against the working directory, so
  # `17 6 * * 1` becomes the file listing and the day-of-week field is read
  # from whatever happened to sort last. Caught by test-audit-health.sh —
  # staleness silently never fired, which is exactly the shape of gate this
  # script exists to find.
  local _min _mon
  read -r _min hour dom _mon dow <<<"$cron"
  [ -z "${dow:-}" ] && { echo 0; return; }
  if   [ "$dom" != "*" ];            then echo $((35 * 86400))   # monthly
  elif [ "$dow" != "*" ];            then echo $((17 * 86400))   # weekly
  elif [ "$hour" != "*" ] && [[ "$hour" != */* ]]; then echo $((3 * 86400))  # daily
  else                                    echo $((86400))        # sub-daily
  fi
}

now=$(date -u +%s)
red=(); stale=(); never=(); unreadable=(); phantom=(); ok_count=0

wf_json=$(gh_json "repos/$OWNER/$REPO/actions/workflows")
if [ $? -ne 0 ]; then
  echo "✗ could not list workflows for $OWNER/$REPO — refusing to report a pass over an empty set"
  exit 2
fi

# Secrets that exist, plus the ones GitHub always provides.
known_secrets=$'GITHUB_TOKEN\ntoken'
if s=$(gh secret list -R "$OWNER/$REPO" --json name --jq '.[].name' 2>/dev/null); then
  known_secrets+=$'\n'"$s"
fi
if s=$(gh api "orgs/$OWNER/actions/secrets" --jq '.secrets[].name' 2>/dev/null); then
  known_secrets+=$'\n'"$s"
fi

printf "%-26s %-9s %-12s %s\n" WORKFLOW LAST AGE VERDICT
printf -- '-%.0s' {1..70}; echo

while IFS=$'\t' read -r wf_id wf_path wf_name wf_state; do
  file="${wf_path##*/}"
  is_not_an_audit "$file" && continue
  [ -f "$wf_path" ] || continue     # only workflows on THIS checkout

  runs=$(gh_json "repos/$OWNER/$REPO/actions/workflows/$wf_id/runs?per_page=1")
  if [ $? -eq 1 ]; then
    unreadable+=("$file")
    printf "%-26s %-9s %-12s %s\n" "$file" "?" "?" "UNREADABLE — withheld"
    continue
  fi

  concl=$(printf '%s' "$runs" | jq -r '.workflow_runs[0].conclusion // empty' 2>/dev/null)
  created=$(printf '%s' "$runs" | jq -r '.workflow_runs[0].created_at // empty' 2>/dev/null)

  # GitHub lists a workflow it REFUSED to parse by its path instead of its
  # name, and every such workflow has zero runs. Both tells, reported together.
  if [ -z "$created" ]; then
    if [ "$wf_name" = "$wf_path" ] || [ "$wf_name" = "$file" ]; then
      never+=("$file (GitHub lists it by PATH — the file was refused, probably a duplicate key)")
    else
      never+=("$file")
    fi
    printf "%-26s %-9s %-12s %s\n" "$file" "never" "-" "NEVER RUN"
    continue
  fi

  ts=$(date -u -d "$created" +%s 2>/dev/null || echo 0)
  age=$(( (now - ts) / 86400 ))
  limit=$(threshold_for "$wf_path")

  verdict="ok"
  if [ "$concl" != "success" ]; then
    red+=("$file (${concl:-in-progress}, ${age}d ago)")
    verdict="RED — ${concl:-in progress}"
  elif [ "$limit" -gt 0 ] && [ $((now - ts)) -gt "$limit" ]; then
    stale+=("$file (last ran ${age}d ago, cadence allows $((limit / 86400))d)")
    verdict="STALE — has stopped firing"
  else
    ok_count=$((ok_count + 1))
  fi
  [ "$wf_state" != "active" ] && verdict="$verdict [WORKFLOW $wf_state]"
  printf "%-26s %-9s %-12s %s\n" "$file" "${concl:-none}" "${age}d ago" "$verdict"
done < <(printf '%s' "$wf_json" | jq -r '.workflows[] | [.id, .path, .name, .state] | @tsv')

# --- 4. can they look at all? -------------------------------------------------
# Secrets that are absent ON PURPOSE. See audit-health.allow for why this is an
# explicit list and not a heuristic.
allow_file="$(dirname "${BASH_SOURCE[0]}")/audit-health.allow"
allowed=""
[ -f "$allow_file" ] && allowed=$(grep -vE '^\s*(#|$)' "$allow_file" | awk '{print $1}')

for f in .github/workflows/*.yml; do
  [ -f "$f" ] || continue
  # Names declared by a reusable workflow's own `secrets:` block are inputs,
  # not repo secrets. auto-merge-sweep.yml is why: its `secrets.token` is a
  # workflow_call parameter and flagging it would be a false positive.
  declared=$(awk '$0 ~ /^ +secrets:/ {s=1; next} s && $0 ~ /^ {0,6}[A-Za-z_][A-Za-z_0-9]*:/ {print $1} s && $0 ~ /^[a-z]/ {s=0}' "$f" 2>/dev/null | tr -d ':')
  for name in $(grep -oE 'secrets\.[A-Za-z_][A-Za-z_0-9]*' "$f" | sed 's/secrets\.//' | sort -u); do
    grep -qxF "$name" <<<"$known_secrets" && continue
    grep -qxF "$name" <<<"$declared" && continue
    [ -n "$allowed" ] && grep -qxF "$name" <<<"$allowed" && continue
    phantom+=("${f##*/} references secrets.$name — which does not exist")
  done
done

echo
echo "audits green: $ok_count"

[ ${#red[@]} -gt 0 ] && { echo; echo "✗ RED — an audit failed and nobody read it:"; printf '    %s\n' "${red[@]}"; }
[ ${#stale[@]} -gt 0 ] && { echo; echo "✗ STALE — an audit has stopped firing:"; printf '    %s\n' "${stale[@]}"; }
[ ${#never[@]} -gt 0 ] && { echo; echo "✗ NEVER RUN:"; printf '    %s\n' "${never[@]}"; }
[ ${#phantom[@]} -gt 0 ] && {
  echo
  echo "✗ PHANTOM SECRET — the chain silently degrades to the repo-scoped default"
  echo "  token, so the audit sweeps the fleet able to see only this one repo:"
  printf '    %s\n' "${phantom[@]}"
}
[ ${#unreadable[@]} -gt 0 ] && {
  echo
  echo "? UNREADABLE — could not look; withheld, NOT counted against the audit:"
  printf '    %s\n' "${unreadable[@]}"
}

if [ "$MODE" = "check" ]; then
  n=$(( ${#red[@]} + ${#stale[@]} + ${#never[@]} + ${#phantom[@]} ))
  if [ "$n" -gt 0 ]; then
    echo
    echo "audit-health: $n problem(s) in the layer that watches everything else"
    exit 1
  fi
  echo
  echo "✓ every fleet audit ran recently, went green, and has a token that exists"
fi
exit 0
