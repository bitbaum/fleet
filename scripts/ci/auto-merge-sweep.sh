#!/usr/bin/env bash
#
# Merge every open PR that is ready and fully green, then re-arm CI/CD.
#
# THIS IS THE CANONICAL COPY. Adopt it via the reusable workflow
# (.github/workflows/auto-merge-sweep.yml) — do not copy this file into a repo.
#
# It WAS copied, into 22 repos, and drifted into EIGHT distinct versions of
# 245–404 lines. Three of them independently grew different fixes for real
# outages, and each fix reached only the repo that wrote it:
#
#   evig, revampit   infra-failure detection + re-run. An Actions incident left
#                    main `failure` with no failed job; 11 PRs stranded ~14h.
#   fleetcrown       DEADLOCK naming — a red base with the fix sitting in the
#                    queue was indistinguishable from "nothing to merge".
#   the other 19     neither.
#
# This file is their UNION, and that is the whole argument for central code: the
# second repo to hit an Actions incident had already been given the answer by
# the first, and never received it.
#
# It is built on the variant 10 repos were already running, with the two fixes
# spliced in — NOT on the longest variant. "Take the biggest file" is not a
# merge strategy: the 404-line version is missing the step-summary reporting
# that the 296-line one has, so picking by size would have silently deleted
# working behaviour from ten repos.
#
# Every repo-specific value is an env var (GH_REPO, BASE_BRANCH, CI_WORKFLOW,
# REARM_WORKFLOWS, MAX_RUN_ATTEMPTS), so there is nothing left to fork over.
#
# WHY THIS EXISTS
# ---------------
# Nobody reviews PRs on this fleet — the owner explicitly does not want to be in
# the merge loop, and background-job agent sessions are barred from merging by
# hand. So the policy lives here, in the repo, where it is visible, revocable,
# and applies uniformly to every PR instead of depending on who opened it.
#
# THE POLICY
#   merge a PR  <=>  it is not a draft
#                    AND carries no hold label
#                    AND has at least one check
#                    AND every check has finished green
#                    AND GitHub reports it cleanly mergeable
#
# Anything else is left alone for the next sweep. Nothing here forces a merge:
# a red or pending PR simply waits, and a draft waits forever. To hold a ready
# PR back, mark it a draft or add one of the hold labels below.
#
# ONE PR PER SWEEP, OLDEST FIRST, AND ONLY ONTO A GREEN BASE
# ----------------------------------------------------------
# A PR's checks prove *that PR against the base it branched from* — not against
# the other PRs sitting next to it. Merging a batch in one pass would put a
# combination onto the base that nothing ever built. So this script merges at
# most one PR, then hands control back to CI: the merge train advances one car
# per sweep, and every car is verified on the base before the next one couples.
#
# For the same reason it refuses to merge while the base's CI is red or still
# running. Red base => stop adding changes until it is fixed; running CI => the
# answer is not in yet. Both simply defer to the next sweep.
#
# THE RE-ARM (do not remove)
#   A push made with the default GITHUB_TOKEN does NOT trigger workflows. Both
#   CI and the deploy workflow here run on push, so a merge from this script
#   would otherwise land on the base branch and never build or ship. Worse, the
#   green-base guard above keys on "a CI run exists for the current tip" — with
#   no CI run ever produced by an automated merge, the very next sweep would
#   block forever. The explicit workflow_dispatch calls at the end restore both.
#
#   REARM_WORKFLOWS is set by .github/workflows/auto-merge.yml and lists exactly
#   the workflows that would otherwise have fired on push.

set -euo pipefail

REPO="${GH_REPO:?GH_REPO must be set}"
BASE_BRANCH="${BASE_BRANCH:-main}"
CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"
REARM_WORKFLOWS="${REARM_WORKFLOWS:-$CI_WORKFLOW}"

# Workflow that ships the base branch, e.g. deploy.yml. EMPTY DISABLES IT, and
# empty is the default: a repo that does not set this behaves exactly as before,
# so adopting the reconciler is opt-in rather than something that starts firing
# deploys in repos that never asked for one.
DEPLOY_WORKFLOW="${DEPLOY_WORKFLOW:-}"

# A PR wearing any of these is never merged automatically.
HOLD_LABELS='["hold","no-automerge","do-not-merge","wip"]'

# How many times a run that produced NO VERDICT may be re-run before the sweep
# gives up on it. Bounded so an endlessly-failing run cannot become an infinite
# re-run loop billing Actions minutes.
MAX_RUN_ATTEMPTS="${MAX_RUN_ATTEMPTS:-3}"

# ── Telling "the code is broken" from "the CI system broke" ──────────────────
#
# A run can end without ever judging the code: cancelled, or failed inside
# GitHub's own "Set up job" step. Treating that as a verdict is what strands a
# queue — and unlike a real failure, nobody gets a signal, because the sweep
# still exits 0 and looks perfectly healthy while merging nothing.
#
# Observed on evig 2026-08-07: an Actions incident left main's run `failure`
# with no failed job at all (one cancelled, the rest green). It held 11 PRs for
# ~14 hours. A genuine failure still blocks — that IS a verdict about the code.
run_failure_is_infra() {
  run_failure_is_infra_id="$1"
  run_failure_is_infra_steps=$(gh api \
    "repos/${REPO}/actions/runs/${run_failure_is_infra_id}/jobs" --paginate \
    --jq '[ .jobs[]
            | select(.conclusion == "failure")
            | [ .steps[]? | select(.conclusion == "failure") | .name ] ]
          | flatten | unique | join("|")' 2>/dev/null) || return 1
  [ -n "$run_failure_is_infra_steps" ] || return 1
  # ONLY when the sole failing step is GitHub's own runner setup. Anything else
  # is the repo's code failing and must keep blocking.
  [ "$run_failure_is_infra_steps" = "Set up job" ]
}

run_conclusion_is_non_verdict() {
  case "$1" in
    cancelled) return 0 ;;
    failure) run_failure_is_infra "$2" ;;
    *) return 1 ;;
  esac
}

rerun_non_verdict_run() {
  rerun_id="$1"
  rerun_what="$2"
  rerun_attempt=$(gh api "repos/${REPO}/actions/runs/${rerun_id}" \
    --jq '.run_attempt // 1' 2>/dev/null || echo "$MAX_RUN_ATTEMPTS")
  if [ "$rerun_attempt" -ge "$MAX_RUN_ATTEMPTS" ]; then
    echo "[auto-merge] ${rerun_what} run ${rerun_id} already at attempt ${rerun_attempt}/${MAX_RUN_ATTEMPTS} — not retrying again" >&2
    return 1
  fi
  echo "[auto-merge] ${rerun_what} run ${rerun_id} produced no verdict (attempt ${rerun_attempt}) — re-running"
  gh run rerun "$rerun_id" --repo "$REPO" \
    || { echo "[auto-merge] could not re-run ${rerun_id}" >&2; return 1; }
}

echo "[auto-merge] sweeping open PRs against ${BASE_BRANCH} in ${REPO}"

# Never add changes to a base that is red or mid-verification.
#
# The run has to belong to the CURRENT tip of the base branch. Checking only
# "the latest CI run" is a trap: right after a merge, the newest run is still
# the *previous* commit's — and it is green — so the guard would wave through a
# second merge onto a commit nothing has verified yet. That is exactly the
# batching this script exists to prevent.
base_sha=$(gh api "repos/${REPO}/commits/${BASE_BRANCH}" --jq '.sha')
base_ci=$(gh run list --repo "$REPO" --workflow "$CI_WORKFLOW" --branch "$BASE_BRANCH" --limit 1 \
  --json databaseId,status,conclusion,headSha --jq '.[0] // empty')

# Declared before the branch that can skip it: `set -u` is on and the merge
# site below always reads it. A base branch with no CI history takes the
# "proceeding" path, and an assignment living only in the else-branch made
# the entire sweep die with "base_red_jobs: unbound variable".
base_red_jobs=""

if [ -z "$base_ci" ]; then
  echo "[auto-merge] no CI history for ${BASE_BRANCH} — proceeding"
else
  base_status=$(printf '%s' "$base_ci" | jq -r '.status')
  base_conclusion=$(printf '%s' "$base_ci" | jq -r '.conclusion // ""')
  base_ci_sha=$(printf '%s' "$base_ci" | jq -r '.headSha')

  if [ "$base_ci_sha" != "$base_sha" ]; then
    echo "[auto-merge] ${BASE_BRANCH} is at ${base_sha:0:8} but the newest CI run is for ${base_ci_sha:0:8} — waiting for CI to catch up"
    exit 0
  fi
  if [ "$base_status" != "completed" ]; then
    echo "[auto-merge] ${BASE_BRANCH} CI is still running — deferring to the next sweep"
    exit 0
  fi
  # A red base must not become a trap for the PR that repairs it.
  #
  # "Never merge onto red" is right for an unrelated change: it stops a broken
  # base quietly collecting more of them and getting harder to diagnose. But
  # when the PR *is* the repair, the same rule deadlocks the repo — the fix
  # cannot travel the path its own redness blocks, and only a human can move
  # it. Seen in bitbaum/aoz-housing on 2026-08-07: E2E red on the base, the
  # fix sitting green in a PR, every sweep refusing politely.
  #
  # So identify WHICH jobs are red and let a PR through only if its own checks
  # pass every one of them. Not a weakening: a PR's checks run on the MERGE
  # result (refs/pull/N/merge), so green-on-those-jobs is direct evidence the
  # post-merge base is better than the pre-merge base. Still refused: a PR that
  # does not cover the failing jobs, one that covers only some of them, and a
  # base failure whose jobs cannot be identified at all.
  if [ "$base_conclusion" != "success" ]; then
    base_run_id=$(printf '%s' "${base_ci}" | jq -r '.databaseId')

    # THE OTHER DEADLOCK: the only thing that produces a new CI run on the base
    # is a merge, and merges are exactly what this guard blocks. So a base run
    # that ended without a verdict strands every open PR until a human notices,
    # and nothing signals that they should.
    if run_conclusion_is_non_verdict "$base_conclusion" "$base_run_id"; then
      rerun_non_verdict_run "$base_run_id" "${BASE_BRANCH}" || true
      echo "[auto-merge] deferring to the next sweep to judge ${BASE_BRANCH}"
      exit 0
    fi

    # NAME THE DEADLOCK. A red base is usually transient; it becomes a deadlock
    # when the only PR that repairs it is sitting in the queue. The guard below
    # already lets a PR through if it is green on the failing jobs — but when
    # none qualifies, the sweep exits 0 and the stall is indistinguishable from
    # "nothing to merge". That is the third time in this fleet a permanent stall
    # looked like an ordinary skip, so make it loud and name the candidates.
    ready=$(gh pr list --repo "$REPO" --state open --base "$BASE_BRANCH" --limit 50 \
      --json number,title,isDraft,mergeStateStatus,labels \
      --jq "[ .[]
              | select(.isDraft | not)
              | select(.mergeStateStatus == \"CLEAN\")
              | select([.labels[].name] - ${HOLD_LABELS} == [.labels[].name])
              | \"  #\(.number) \(.title)\" ] | .[]" 2>/dev/null)
    if [ -n "$ready" ]; then
      echo "[auto-merge] ⚠ DEADLOCK RISK: ${BASE_BRANCH} is red and these green PRs are waiting — one may be the fix:" >&2
      printf '%s\n' "$ready" >&2
    fi

    base_red_jobs=$(gh run view "${base_run_id}" --repo "$REPO" --json jobs \
      --jq '[.jobs[] | select(.conclusion == "failure") | .name] | .[]' 2>/dev/null || true)
    if [ -z "${base_red_jobs}" ]; then
      echo "[auto-merge] ${BASE_BRANCH} CI is ${base_conclusion} and no failing job could be identified — refusing to merge onto a broken base" >&2
      exit 0
    fi
    echo "[auto-merge] ${BASE_BRANCH} CI is ${base_conclusion} — failing: $(printf '%s' "${base_red_jobs}" | tr '\n' ' ')" >&2
    echo "[auto-merge] only a PR that is green on those exact jobs may merge (its checks run on the merge result)"
  fi
fi

# ── Reconcile: a green base must be what is LIVE ─────────────────────────────
#
# Deployment is a RECONCILER, not a chain. A push made with GITHUB_TOKEN emits
# no workflow_run event, and — one level deeper than anyone expects — neither
# does a run that GITHUB_TOKEN itself dispatched. So nothing downstream ever
# wakes on an automated merge. Observed on fleetcrown 2026-08-05: three PRs
# merged, main green, zero Deploy runs created. Invisible, because CI itself ran
# and went green.
#
# So instead of trusting a trigger, compare desired state (the base's tip) with
# actual state (the last successful deploy) and close the gap. That is
# self-healing by construction: a deploy that never fired, or fired and failed,
# is retried by the next sweep instead of leaving a commit merged-but-not-live.
#
# THE GREEN GUARD IS NOT OPTIONAL. The variant this came from exited on a red
# base, so reaching the reconciler there proved the tip was green. This script
# deliberately does NOT exit on red — it lets a PR that repairs the base through
# — so the same code placed here without `-z "$base_red_jobs"` would ship a tip
# whose CI is failing. Same lines, different surrounding control flow, opposite
# meaning.
if [ -n "$DEPLOY_WORKFLOW" ] && [ -n "${base_ci:-}" ] && [ -z "${base_red_jobs}" ]; then
  deploy_running=$(gh run list --repo "$REPO" --workflow "$DEPLOY_WORKFLOW" --limit 5 \
    --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo 0)
  deployed_sha=$(gh run list --repo "$REPO" --workflow "$DEPLOY_WORKFLOW" --branch "$BASE_BRANCH" \
    --status success --limit 1 --json headSha --jq '.[0].headSha // ""' 2>/dev/null || echo "")

  if [ "${deploy_running:-0}" -gt 0 ]; then
    echo "[auto-merge] a deploy is already in flight — not dispatching another"
  elif [ "$deployed_sha" = "$base_sha" ]; then
    echo "[auto-merge] ${BASE_BRANCH} ${base_sha:0:8} is already deployed"
  else
    echo "[auto-merge] ${BASE_BRANCH} is at ${base_sha:0:8}; last successful deploy was ${deployed_sha:0:8}${deployed_sha:+ } — shipping"
    gh workflow run "$DEPLOY_WORKFLOW" --repo "$REPO" --ref "$BASE_BRANCH" \
      || echo "[auto-merge] could not dispatch ${DEPLOY_WORKFLOW} — is workflow_dispatch declared?" >&2
  fi
fi

prs_json=$(gh pr list --repo "$REPO" --state open --base "$BASE_BRANCH" --limit 50 \
  --json number,title,isDraft,mergeable,mergeStateStatus,labels,statusCheckRollup,createdAt)

count=$(printf '%s' "$prs_json" | jq 'length')
if [ "$count" -eq 0 ]; then
  echo "[auto-merge] no open PRs"
  exit 0
fi

merged_any=0

# OLDEST FIRST. `gh pr list` returns newest-first, and this loop merges the
# first eligible PR and stops — so the newest green PR wins every sweep and an
# older one can wait indefinitely. Observed in bitbaum/fleetcrown on
# 2026-08-06: two consecutive sweeps merged the two newest PRs while three
# older green ones were never even evaluated. With several agent sessions
# opening PRs continuously, "newest wins" is starvation, and it starves the PR
# whose checks were proven against the most now-stale base.
#
# PR numbers increase monotonically with creation, so sorting ascending is FIFO.
for number in $(printf '%s' "$prs_json" | jq -r 'sort_by(.number) | .[].number'); do
  pr=$(printf '%s' "$prs_json" | jq -c --argjson n "$number" '.[] | select(.number == $n)')
  title=$(printf '%s' "$pr" | jq -r '.title')

  # A rollup entry is either a CheckRun (status + conclusion) or a commit
  # StatusContext (state) — external services report as the latter.
  verdict=$(printf '%s' "$pr" | jq -r --argjson hold "$HOLD_LABELS" '
    def ok:
      if has("state") then (.state == "SUCCESS")
      else ((.status == "COMPLETED")
            and ((.conclusion // "") | test("^(SUCCESS|NEUTRAL|SKIPPED)$"))) end;
    def pending:
      if has("state") then (.state == "PENDING")
      else (.status != "COMPLETED") end;

    . as $pr
    | (($pr.statusCheckRollup) // []) as $checks
    | if $pr.isDraft then "skip: draft"
      elif ([$pr.labels[]?.name] | any(. as $l | $hold | index($l) != null))
        then "skip: hold label"
      elif ($checks | length) == 0 then "skip: no checks reported yet"
      elif ($checks | map(pending) | any) then "skip: checks still running"
      elif (($checks | map(ok) | all) | not) then "skip: checks not green"
      else "merge" end
  ')

  if [ "$verdict" != "merge" ]; then
    echo "[auto-merge] #${number} ${verdict} — ${title}"

    # "No checks reported yet" is transient for a PR opened seconds ago and
    # PERMANENT for an old one: GitHub does not retroactively run workflows on
    # a PR nobody has pushed to, so it will sit here forever looking patient.
    # Report it; only a push, or a close/reopen, will ever produce checks.
    if [ "$verdict" = "skip: no checks reported yet" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      created=$(printf '%s' "$pr" | jq -r '.createdAt // ""')
      if [ -n "$created" ] && [ "$created" \< "$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ)" ]; then
        echo "- ⚠️ #${number} has no checks and is over 2h old — it will never gain any on its own — ${title}" >> "$GITHUB_STEP_SUMMARY"
      fi
    fi

    # A CANCELLED check is not a verdict, it is noise: CI workflows in this
    # fleet use `concurrency: cancel-in-progress`, so an unrelated newer run on
    # the same ref can kill a PR's build. Nothing ever re-runs it, the PR is
    # never green, and it would sit in this queue forever. Re-run it and let a
    # later sweep judge the real result. Genuine failures are left alone; only a
    # run with no real failure is retried.
    if [ "$verdict" = "skip: checks not green" ]; then
      retry_urls=$(printf '%s' "$pr" | jq -r '
        [ .statusCheckRollup[]?
          | select(has("state") | not)
          | select((.conclusion // "") == "CANCELLED")
          | .detailsUrl ] as $cancelled
        | [ .statusCheckRollup[]?
            | select(((.conclusion // .state // "")
                      | test("^(FAILURE|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE|ERROR)$"))) ] as $failed
        | if ($failed | length) == 0 then $cancelled[] else empty end
      ')
      for url in $retry_urls; do
        run_id=$(printf '%s' "$url" | grep -oE '/runs/[0-9]+' | grep -oE '[0-9]+' || true)
        [ -z "$run_id" ] && continue
        echo "[auto-merge] #${number} re-running cancelled run ${run_id}"
        gh run rerun "$run_id" --repo "$REPO" || echo "[auto-merge] #${number} could not re-run ${run_id}" >&2
      done
    fi
    continue
  fi

  # Mergeability is computed lazily by GitHub and is invalidated every time the
  # base branch moves — so right after a merge (exactly when this workflow runs)
  # every PR reports UNKNOWN. Poll until GitHub has an answer instead of
  # treating "not computed yet" as "not mergeable"; otherwise the fast path can
  # never merge anything and the whole train falls back to the cron.
  mergeable=""
  state=""
  for attempt in 1 2 3 4 5 6; do
    fresh=$(gh pr view "$number" --repo "$REPO" --json mergeable,mergeStateStatus)
    mergeable=$(printf '%s' "$fresh" | jq -r '.mergeable')
    state=$(printf '%s' "$fresh" | jq -r '.mergeStateStatus')
    [ "$mergeable" != "UNKNOWN" ] && break
    echo "[auto-merge] #${number} mergeability not computed yet (attempt ${attempt}) — waiting"
    sleep 5
  done

  # A conflicted PR is not "not ready yet" — it is stuck, and nothing else will
  # unstick it. Skipping it quietly is how a PR sits DIRTY while the base moves
  # on: every sweep passes over it in silence and no signal ever reaches a
  # human. Say it loudly, and put it in the job summary where it is seen.
  if [ "$mergeable" = "CONFLICTING" ]; then
    echo "[auto-merge] #${number} CONFLICTS with ${BASE_BRANCH} and will never merge itself — ${title}" >&2
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo "- ⚠️ #${number} conflicts with \`${BASE_BRANCH}\` and needs resolving — ${title}" >> "$GITHUB_STEP_SUMMARY"
    fi
    continue
  fi

  if [ "$mergeable" != "MERGEABLE" ]; then
    echo "[auto-merge] #${number} skip: not mergeable (${mergeable}/${state}) — ${title}"
    continue
  fi

  # Keep the branch current instead of merging a PR that was proven against an
  # older base. This is also how conflicts surface EARLY: a branch updated on
  # the sweep after the merge that broke it fails here, minutes later, rather
  # than hours later when someone finally looks. One update per sweep, for the
  # same reason only one PR is merged per sweep.
  if [ "$state" = "BEHIND" ]; then
    echo "[auto-merge] #${number} is behind ${BASE_BRANCH} — updating it before merging: ${title}"
    if gh api -X PUT "repos/${REPO}/pulls/${number}/update-branch" --silent 2>/dev/null; then
      echo "[auto-merge] #${number} updated; its checks now run against current ${BASE_BRANCH}"
    else
      echo "[auto-merge] #${number} update-branch failed — leaving for the next sweep" >&2
    fi
    break
  fi

  # Red base: this PR merges only if it proves every failing job green.
  if [ -n "${base_red_jobs}" ]; then
    pr_green=$(printf '%s' "$pr" | jq -r '
      [ .statusCheckRollup[]?
        | select(((.conclusion // .state // "") | test("^(SUCCESS|NEUTRAL|SKIPPED)$")))
        | (.name // .context) ] | .[]')
    uncovered=""
    while IFS= read -r job; do
      [ -z "$job" ] && continue
      printf '%s\n' "$pr_green" | grep -Fxq "$job" || uncovered="${uncovered}${job}; "
    done <<INNER_EOF
${base_red_jobs}
INNER_EOF
    if [ -n "$uncovered" ]; then
      echo "[auto-merge] #${number} skip: ${BASE_BRANCH} is red on [${uncovered%; }] and this PR does not prove those green — ${title}"
      continue
    fi
    echo "[auto-merge] #${number} is green on every job ${BASE_BRANCH} fails — merging it to repair the base: ${title}" >&2
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo "- 🔧 #${number} merged onto a red \`${BASE_BRANCH}\` because it passes every failing job — ${title}" >> "$GITHUB_STEP_SUMMARY"
    fi
  fi

  echo "[auto-merge] #${number} green and ready — merging: ${title}"
  if gh pr merge "$number" --repo "$REPO" --squash --delete-branch; then
    merged_any=1
    echo "[auto-merge] #${number} merged"
    # One car per sweep: let CI verify this on the base before the next couples.
    break
  else
    # Losing a race (someone merged first, or the base moved underneath) is
    # normal; the next sweep re-evaluates from fresh state.
    echo "[auto-merge] #${number} merge failed — leaving for the next sweep" >&2
  fi
done

if [ "$merged_any" -eq 1 ]; then
  for wf in $REARM_WORKFLOWS; do
    echo "[auto-merge] re-arming ${wf} on ${BASE_BRANCH}"
    gh workflow run "$wf" --repo "$REPO" --ref "$BASE_BRANCH" \
      || echo "[auto-merge] could not dispatch ${wf} — is workflow_dispatch declared?" >&2
  done
else
  echo "[auto-merge] nothing merged; no re-arm needed"
fi