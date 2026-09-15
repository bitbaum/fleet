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
#   automerge-miswired  The sweep lives ONCE (bitbaum/fleet) and each repo's
#                    auto-merge.yml is a ~10-line caller — but a caller can be
#                    wrong in ways no run ever reports, found 2026-09-15:
#                      - a DUPLICATE MAPPING KEY. GitHub refuses the whole file,
#                        lists the workflow by its path instead of its name, and
#                        every run is a zero-job failure. dotfiles carried two
#                        `secrets:` blocks and merged nothing for days; a sweep
#                        that fails to start looks exactly like one with nothing
#                        to merge.
#                      - it names a workflow the repo does not HAVE. The sweep
#                        dispatches it after every merge, logs "could not
#                        dispatch", and exits 0. substrata and camille-boulangerie
#                        both re-armed a publish.yml that did not exist.
#                      - it neither calls the reusable workflow nor runs the
#                        canonical script inline (only fleet itself may do the
#                        latter — shared-inventory.sh ratchets that count).
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

# A CI concurrency group that does not vary by commit lets a newer merge cancel
# an older commit's run — and every deploy path keys off that run. Deploys that
# wait for CI on the commit find a cancelled run and stop; deploys chained on
# workflow_run see conclusion=cancelled and skip. The re-armed dispatch
# auto-merge sends does the same thing to the push run for the SAME commit.
#
# Only a violation when the group can actually collide across commits: a group
# already keyed by github.sha, or one that never cancels, is fine.
ci_can_strand_a_commit() {
  local body group
  body=$(sed 's/#.*//' "$1")
  printf '%s' "$body" | grep -qE 'cancel-in-progress:[[:space:]]*true' || return 1
  group=$(printf '%s' "$body" | grep -A2 '^concurrency:' | grep 'group:' | head -1)
  [ -n "$group" ] || return 1
  printf '%s' "$group" | grep -q 'github\.sha' && return 1
  return 0
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

# ── auto-merge caller predicates ─────────────────────────────────────────────

# Print every mapping key that appears twice among its siblings. No YAML
# parser on purpose — the audit must run wherever bash and awk do — so this
# tracks (indent, key) pairs and forgets deeper ones whenever a shallower key
# starts a new subtree. A `- ` item opens a fresh mapping, so two `- cron:`
# entries in a list are siblings of the LIST, not duplicates of each other.
yaml_duplicate_keys() {
  sed 's/#.*//' "$1" | awk '
    /^[[:space:]]*$/ { next }
    {
      match($0, /^ */); ind = RLENGTH
      rest = substr($0, ind + 1)
      if (rest ~ /^- /) {
        for (k in seen) { split(k, p, SUBSEP); if (p[1] + 0 > ind) delete seen[k] }
        ind += 2; rest = substr(rest, 3)
      }
      if (rest !~ /^[A-Za-z0-9_.-]+:([[:space:]]|$)/) next
      key = rest; sub(/:.*/, "", key)
      for (k in seen) { split(k, p, SUBSEP); if (p[1] + 0 > ind) delete seen[k] }
      if ((ind, key) in seen) print key
      seen[ind, key] = 1
    }'
}

calls_the_sweep() {
  sed 's/#.*//' "$1" \
    | grep -qE 'uses:[[:space:]]*bitbaum/fleet/\.github/workflows/auto-merge-sweep\.ya?ml@'
}

runs_the_sweep_inline() {
  sed 's/#.*//' "$1" | grep -qE 'run:.*scripts/ci/auto-merge-sweep\.sh'
}

# The workflow FILES a caller points the sweep at: the CI gate, the re-arm list
# (space-separated) and the deploy reconciler. Both the reusable inputs and the
# inline env names, so fleet's own file is held to the same rule. Expressions
# are skipped — they resolve at run time and cannot be checked as text.
automerge_named_workflows() {
  sed 's/#.*//' "$1" | awk '
    /^[[:space:]]*(ci_workflow|CI_WORKFLOW|rearm_workflows|REARM_WORKFLOWS|deploy_workflow|DEPLOY_WORKFLOW):/ {
      sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, "")
      n = split($0, a, /[[:space:]]+/)
      for (i = 1; i <= n; i++) if (a[i] != "" && a[i] !~ /\$/) print a[i]
    }'
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
      ci_can_strand_a_commit "$f" && printf 'ci-strands-commits\t%s\n' "$(basename "$f")"
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

  # The auto-merge caller. Only repos that opted in have one; a repo with no
  # such file is not miswired, it is simply not auto-merging.
  local am="$wf/auto-merge.yml" dup named
  if [ -f "$am" ]; then
    while IFS= read -r dup; do
      [ -n "$dup" ] || continue
      printf 'automerge-miswired\t%s\n' "auto-merge.yml: duplicate key '$dup' — GitHub refuses the whole file"
    done < <(yaml_duplicate_keys "$am")
    if ! calls_the_sweep "$am" && ! runs_the_sweep_inline "$am"; then
      printf 'automerge-miswired\t%s\n' "auto-merge.yml: neither calls bitbaum/fleet auto-merge-sweep.yml nor runs scripts/ci/auto-merge-sweep.sh"
    fi
    while IFS= read -r named; do
      [ -n "$named" ] || continue
      [ -f "$wf/$named" ] \
        || printf 'automerge-miswired\t%s\n' "auto-merge.yml names $named, which the repo does not have"
    done < <(automerge_named_workflows "$am")
  fi
}

# ── Collect ──────────────────────────────────────────────────────────────────
declare -A COUNTS=()
ORDER="deploy-cancels deploy-reverifies cold-ci-build automerge-miswired"
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
