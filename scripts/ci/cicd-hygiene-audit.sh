#!/usr/bin/env bash
# Fleet audit: is the SHAPE of each repo's pipeline sound?
#
# verify-floor-audit.sh already asks whether `verify` runs the right gates.
# This asks a different question that no check covered: given that the gates are
# right, is the pipeline around them wasteful or unsafe? Those are not style
# points. Each of the three checks below is here because it cost this fleet
# something measurable on 2026-09-07:
#
#   deploy-cancels   evig set `cancel-in-progress: true` on a ~13-minute deploy.
#                    4 of its last 10 deploys were CANCELLED — 40%, against 0%
#                    for all seven other repos measured. Three cancelled each
#                    other in a row and a merged fix took three attempts to
#                    reach production. Cancelling is only safe when the newer
#                    run is guaranteed to finish; at 13 minutes it is not.
#                    (CI is different — cancelling a superseded CI run is right,
#                    which is why this check looks ONLY at deploy workflows.)
#
#   deploy-reverifies  evig's deploy ran `pnpm run verify` — the same bundle CI
#                    runs, CONCURRENTLY, on the same SHA. The commit was built
#                    four times per merge and only the last build shipped.
#                    Requiring CI's green is the same coverage for one build.
#
#   cold-ci-build    Next keeps its compiler output in .next/cache. Measured
#                    across 8 repos, exactly ONE cached it in CI. Everyone else
#                    recompiled from scratch on every run, twice per merge.
#
# Like every audit here this is ONE central script reading each repo's REMOTE
# default branch, never a check copied per repo: auto-merge-sweep.sh was copied
# into 17 repos and now has 5 live variants, so a fix in one reaches none.
#
# SCOPE — what this does NOT prove. It reads workflow YAML as text, so it audits
# the pipeline's declared shape, not its behaviour. A repo that caches
# .next/cache under a key that never hits still passes here; a repo whose deploy
# calls a script that internally re-runs verify passes too. Contract first.
# Effectiveness is measurable (run durations) and belongs in a separate check.
#
# Usage:
#   scripts/ci/cicd-hygiene-audit.sh            # report
#   scripts/ci/cicd-hygiene-audit.sh --check    # ratchet: exit 1 if a count ROSE
#   scripts/ci/cicd-hygiene-audit.sh --update   # rewrite the baseline, in a PR
#
# Env: GH_OWNER (default bitbaum), GH_LIMIT (default 100)
#      CICD_HYGIENE_FIXTURE_DIR — audit a local directory of fixture repos
#      instead of GitHub. Used by test-cicd-hygiene-audit.sh so the predicates
#      are provable without a network round-trip.

set -uo pipefail

OWNER="${GH_OWNER:-bitbaum}"
LIMIT="${GH_LIMIT:-100}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASELINE="${CICD_HYGIENE_BASELINE:-$HERE/cicd-hygiene.baseline}"
FIXTURES="${CICD_HYGIENE_FIXTURE_DIR:-}"

MODE=report
case "${1:-}" in
  --check)  MODE=check ;;
  --update) MODE=update ;;
  "")       MODE=report ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

if [ -z "$FIXTURES" ]; then
  command -v gh >/dev/null 2>&1 || { echo "gh CLI not found" >&2; exit 2; }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Predicates ───────────────────────────────────────────────────────────────
#
# Each takes a directory holding one repo's workflow files (plus a marker file
# `.is-next` when the repo depends on next) and prints one line per violation.
# Kept as functions so the test can call them directly on fixtures.

# A workflow is a DEPLOY workflow if its filename says so. Deliberately by name:
# reading `on:` triggers would also match every CI workflow that runs on push to
# main, and the distinction that matters here is intent, which the name carries.
is_deploy_file() {
  case "$(basename "$1")" in
    deploy*|cd.yml|cd.yaml|*-deploy.yml|*-deploy.yaml|release*) return 0 ;;
    *) return 1 ;;
  esac
}

is_ci_file() {
  case "$(basename "$1")" in
    ci.yml|ci.yaml|ci-*.yml|ci-*.yaml|verify*|test*) return 0 ;;
    *) return 1 ;;
  esac
}

# Does this file set cancel-in-progress: true anywhere?
#
# Comment-blind matching desyncs on prose — a file explaining WHY it does not
# cancel would otherwise be reported as cancelling. Strip comments first.
sets_cancel_true() {
  sed 's/#.*//' "$1" | grep -qE 'cancel-in-progress:[[:space:]]*true'
}

runs_verify_bundle() {
  sed 's/#.*//' "$1" \
    | grep -qE 'run:.*(npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?verify\b'
}

runs_a_build() {
  sed 's/#.*//' "$1" \
    | grep -qE 'run:.*((npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?(build|verify)\b|next[[:space:]]+build)'
}

caches_next_build() {
  sed 's/#.*//' "$1" | grep -q '\.next/cache'
}

# Audit one repo directory; prints "check<TAB>detail" per violation.
audit_repo_dir() {
  local dir="$1" wf f
  wf="$dir/workflows"
  [ -d "$wf" ] || return 0

  local ci_verifies=0 ci_builds=0 ci_caches=0
  for f in "$wf"/*; do
    [ -f "$f" ] || continue
    if is_deploy_file "$f"; then
      sets_cancel_true "$f" && printf 'deploy-cancels\t%s\n' "$(basename "$f")"
    fi
    if is_ci_file "$f"; then
      runs_verify_bundle "$f" && ci_verifies=1
      runs_a_build "$f" && ci_builds=1
      caches_next_build "$f" && ci_caches=1
    fi
  done

  for f in "$wf"/*; do
    [ -f "$f" ] || continue
    is_deploy_file "$f" || continue
    # Only a violation when CI already runs the same bundle on the same commit.
    # A repo whose ONLY verification is in its deploy is not duplicating work.
    if [ "$ci_verifies" = 1 ] && runs_verify_bundle "$f"; then
      printf 'deploy-reverifies\t%s\n' "$(basename "$f")"
    fi
  done

  # Only meaningful for Next apps that actually compile in CI.
  if [ -f "$dir/.is-next" ] && [ "$ci_builds" = 1 ] && [ "$ci_caches" = 0 ]; then
    printf 'cold-ci-build\t%s\n' "ci builds without .next/cache"
  fi
}

# ── Collect ──────────────────────────────────────────────────────────────────
declare -A COUNTS=()
ORDER="deploy-cancels deploy-reverifies cold-ci-build"
for k in $ORDER; do COUNTS[$k]=0; done
detail_file="$TMP/details"
: > "$detail_file"
inspected=0

collect_from_dir() {
  local repo="$1" dir="$2" line check what
  while IFS=$'\t' read -r check what; do
    [ -n "$check" ] || continue
    COUNTS[$check]=$(( ${COUNTS[$check]:-0} + 1 ))
    printf '%s\t%s\t%s\n' "$check" "$repo" "$what" >> "$detail_file"
  done < <(audit_repo_dir "$dir")
  inspected=$(( inspected + 1 ))
}

if [ -n "$FIXTURES" ]; then
  for d in "$FIXTURES"/*; do
    [ -d "$d" ] || continue
    collect_from_dir "$(basename "$d")" "$d"
  done
else
  repos=$(gh repo list "$OWNER" --limit "$LIMIT" --no-archived --source \
            --json name,defaultBranchRef \
            --jq '.[] | "\(.name)\t\(.defaultBranchRef.name // "")"' 2>/dev/null)
  [ -n "$repos" ] || { echo "could not list repos for $OWNER" >&2; exit 2; }

  while IFS=$'\t' read -r name branch; do
    [ -n "$name" ] && [ -n "$branch" ] || continue
    tree=$(gh api "repos/$OWNER/$name/git/trees/$branch?recursive=1" 2>/dev/null) || continue
    [ -n "$tree" ] || continue

    paths=$(printf '%s' "$tree" | jq -r '.tree[]?.path' 2>/dev/null)
    [ -n "$paths" ] || continue

    d="$TMP/$name"; mkdir -p "$d/workflows"
    # Marker: does this repo depend on next? package.json at the root is enough
    # — a repo with Next nested deeper is not one this check can reason about.
    if printf '%s\n' "$paths" | grep -qx 'package.json'; then
      pj=$(gh api "repos/$OWNER/$name/contents/package.json?ref=$branch" \
             --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
      printf '%s' "$pj" | grep -q '"next"[[:space:]]*:' && : > "$d/.is-next"
    fi

    got=0
    while IFS= read -r p; do
      case "$p" in .github/workflows/*.yml|.github/workflows/*.yaml) ;; *) continue ;; esac
      body=$(gh api "repos/$OWNER/$name/contents/$p?ref=$branch" --jq '.content' 2>/dev/null \
               | base64 -d 2>/dev/null)
      [ -n "$body" ] || continue
      printf '%s' "$body" > "$d/workflows/$(basename "$p")"
      got=1
    done < <(printf '%s\n' "$paths")

    [ "$got" = 1 ] || continue
    collect_from_dir "$name" "$d"
  done <<< "$repos"
fi

# ── Report ───────────────────────────────────────────────────────────────────
print_report() {
  printf '%-20s %s\n' "check" "count"
  for k in $ORDER; do
    printf '%-20s %s\n' "$k" "${COUNTS[$k]:-0}"
    while IFS=$'\t' read -r c repo what; do
      [ "$c" = "$k" ] || continue
      printf '    %-14s %s\n' "$repo" "$what"
    done < "$detail_file"
  done
  echo
  echo "inspected $inspected repo(s)"
}

case "$MODE" in
  report)
    print_report
    echo
    echo "A count is not a verdict — see templates/ci/README.md for the shape these"
    echo "checks are pushing toward, and why each one is there."
    ;;
  update)
    : > "$BASELINE"
    for k in $ORDER; do printf '%s\t%s\n' "$k" "${COUNTS[$k]:-0}" >> "$BASELINE"; done
    print_report
    echo
    echo "baseline rewritten: $BASELINE"
    ;;
  check)
    [ -f "$BASELINE" ] || { echo "no baseline at $BASELINE — run --update first" >&2; exit 2; }
    rose=0
    while IFS=$'\t' read -r k want; do
      [ -n "$k" ] || continue
      have="${COUNTS[$k]:-0}"
      if [ "$have" -gt "$want" ]; then
        echo "✗ $k: $want → $have. The ratchet only turns one way."
        while IFS=$'\t' read -r c repo what; do
          [ "$c" = "$k" ] || continue
          printf '    %-14s %s\n' "$repo" "$what"
        done < "$detail_file"
        rose=1
      elif [ "$have" -lt "$want" ]; then
        echo "✓ $k: $want → $have — run --update to lock it in."
      fi
    done < "$BASELINE"
    if [ "$rose" = 1 ]; then
      echo
      echo "A pipeline regressed. Fix it, or — if this shape is genuinely right"
      echo "here — run --update in the SAME PR so a human sees the decision"
      echo "instead of inheriting it."
      exit 1
    fi
    echo "✓ pipeline hygiene did not regress (inspected $inspected repos)"
    ;;
esac
