#!/usr/bin/env bash
#
# Fleet audit: is every repo actually being TOLD about its vulnerabilities?
#
#   dependabot-alerts-audit.sh [--check] [--fix]
#
# WHY
#
# 2026-09-10: surf-your-life.orangecat.ch was serving Next 16.2.3 — two
# CRITICAL unauthenticated RCE advisories — plus a critical @auth/core flaw and
# six more high findings. Thirteen in total, on a live site, for months.
#
# Nothing was broken. Nothing was ignored. Dependabot alerts were simply OFF for
# that repo, so GitHub never raised one and no human ever saw a number to act
# on. The correlation across the fleet that day was exact:
#
#   botsmann   alerts ON  -> Dependabot opened #193, next 16.2.12 -> 16.3.3, fixed
#   orangecat  alerts ON  -> its own security job went red, and the RCEs got found
#   surf-your-life OFF    -> silence, and 1 critical + 6 high sat there
#
# 17 of 24 repos were off. The instrument was missing, not the diligence.
#
# WHY NOT THE CURRENCY SWEEP
#
# version-currency.mjs cannot see this and never could. It compares MAJORS
# parsed out of package.json ranges — `parseMajor("^16.2.12")` is 16, blessed is
# 16, no gap. Every minor and patch is invisible to it, and it reads declared
# RANGES while the lockfile decides what ships. Both vulnerable pins in that
# incident returned zero gaps from it. The two audits are complements: currency
# asks "are we on the blessed major", this asks "would anyone be told if we
# weren't".
#
# WHY GITHUB'S FLAG RATHER THAN RUNNING pnpm audit HERE
#
# `pnpm audit` needs a lockfile, an install, and a registry round-trip per repo
# — minutes of CI to re-derive what GitHub already computes continuously from
# the same lockfiles. The durable property is not "zero vulnerabilities today";
# it is "the alarm is wired". Wire the alarm once and every future advisory
# arrives on its own, including for repos nobody is looking at.
#
# WHY THERE IS NO BASELINE, UNLIKE ITS SIBLINGS
#
# shared-inventory and cicd-hygiene ratchet a count downward because their
# findings are judgement calls with legitimate exceptions. This one has no
# legitimate exception: a repo with alerts off is a repo that cannot report a
# CVE. The correct number is zero, permanently, so the gate is a hard floor. A
# baseline here would only make "some repos are deaf" an accepted state.
#
# ARCHIVED AND FORKS ARE EXCLUDED — same exemptions as version-currency.mjs, so
# both audits measure the same population. Nothing deploys from an archive, and
# a fork's dependency policy belongs to upstream.
#
# THE REPO LIST COMES FROM `gh repo list`, NOT `ls ~/dev`. A local working area
# accumulates stale directories: on the day this was written ~/dev/revamp-info
# was a checkout whose remote pointed at bitbaum/hirnli, and a hand-typed sweep
# built from that listing both invented a repo that does not exist AND missed
# 17 that do — including every shared package (ai-kit, ai-forms, bip-kit,
# limitkit, threadkit, design-tokens), which are published to npm and consumed
# by every app, so a vulnerability in one propagates fleet-wide.
#
set -uo pipefail

OWNER="${GH_OWNER:-bitbaum}"
LIMIT="${GH_LIMIT:-200}"
MODE="report"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --fix)   MODE="fix" ;;
    *) echo "usage: $(basename "$0") [--check] [--fix]" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "✗ gh CLI not found"; exit 2; }

# An UNREADABLE repo must not read as a passing one. A 403/500 here means the
# audit could not look — which is a third answer, not a green.
repos=$(gh repo list "$OWNER" --limit "$LIMIT" --json name,isArchived,isFork \
  --jq '.[] | select(.isArchived == false and .isFork == false) | .name' 2>/dev/null | sort)
if [ -z "$repos" ]; then
  echo "✗ could not list repos for $OWNER — refusing to report a pass over an empty set"
  exit 2
fi

off=(); unknown=(); on_count=0

for r in $repos; do
  code=$(gh api -i "repos/$OWNER/$r/vulnerability-alerts" 2>/dev/null | head -1 | grep -oE '[0-9]{3}' | head -1)
  case "$code" in
    204) on_count=$((on_count + 1)) ;;
    404) off+=("$r") ;;
    *)   unknown+=("$r(${code:-no-response})") ;;
  esac
done

total=$(echo "$repos" | wc -l | tr -d ' ')
echo "dependabot alerts: $on_count/$total enabled  (owner: $OWNER)"

if [ "${#off[@]}" -gt 0 ]; then
  echo
  echo "OFF — these repos cannot report a CVE to anyone:"
  for r in "${off[@]}"; do echo "    $r"; done
fi

if [ "${#unknown[@]}" -gt 0 ]; then
  echo
  echo "UNREADABLE — the audit could not look; this is not a pass:"
  for r in "${unknown[@]}"; do echo "    $r"; done
fi

if [ "$MODE" = "fix" ]; then
  [ "${#off[@]}" -eq 0 ] && { echo; echo "nothing to fix"; exit 0; }
  echo
  echo "enabling alerts + automated security-fix PRs:"
  for r in "${off[@]}"; do
    a=$(gh api -X PUT "repos/$OWNER/$r/vulnerability-alerts" >/dev/null 2>&1 && echo ok || echo FAIL)
    b=$(gh api -X PUT "repos/$OWNER/$r/automated-security-fixes" >/dev/null 2>&1 && echo ok || echo FAIL)
    echo "    $r  alerts=$a  auto-fix-prs=$b"
  done
  echo
  echo "re-run with --check to confirm"
  exit 0
fi

if [ "$MODE" = "check" ]; then
  if [ "${#off[@]}" -gt 0 ] || [ "${#unknown[@]}" -gt 0 ]; then
    echo
    echo "✗ every repo must be able to report a vulnerability. Fix with:"
    echo "    scripts/ci/dependabot-alerts-audit.sh --fix"
    exit 1
  fi
  echo "✓ every repo can report a vulnerability"
fi

exit 0
