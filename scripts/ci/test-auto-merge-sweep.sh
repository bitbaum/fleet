#!/usr/bin/env bash
#
# Executes the REAL auto-merge-sweep.sh against a fake `gh` on PATH.
#
# Ported from evig, which was the only repo in the fleet that had tests for its
# sweep — and they were about to be deleted along with its copy of the script.
# That would have been the worst possible trade: centralising the code while
# throwing away the only evidence it behaves. The tests are as much a shared
# asset as the script, so they moved here with it.
#
# This tests SHIPPED CONTROL FLOW, not a description of it. A stubbed
# re-implementation of the guard would pass happily while the real script
# deadlocks — which is exactly what happened on 2026-08-07, when an Actions
# incident left main `failure` with no failed job and the sweep refused every
# merge for ~14 hours while still exiting 0 and looking healthy.
#
# The sweep must ALWAYS exit 0: it is a scheduled janitor, not a gate. A
# non-zero exit means the fake `gh` hit an unhandled call shape, which would
# make every assertion below vacuous — so that is checked first, every time.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SWEEP="$HERE/auto-merge-sweep.sh"
PASS=0
FAIL=0

ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

# run_sweep <conclusion> <failed-steps> <run-attempt> [deploy-workflow] [deployed-sha] [running]
#
# Optional globals, consumed and RESET on every call so one case's fixture can
# never leak into the next:
#   RS_STATUS    base run status        (default completed)
#   RS_HEADSHA   base run's headSha     (default the branch tip)
#   RS_PRS       JSON array for pr list (default [])
#   RS_VIEW      JSON for pr view       (default MERGEABLE/CLEAN)
#   RS_BASESHA   the base branch tip    (default basesha000000)
#   RS_HEADBRANCH  base run's headBranch (default: field absent)
#   RS_LIVE      body the LIVE_COMMIT_URL answers; the literal UNREACHABLE makes
#                curl fail. Unset = LIVE_COMMIT_URL is not set at all.
#
# Emits the sweep's combined output; records gh calls in $GH_LOG.
run_sweep() {
  local conclusion="$1" failed_steps="${2:-}" attempt="${3:-1}"
  local deploy_wf="${4:-}" deployed_sha="${5:-}" deploy_running="${6:-0}" rearm_seen="${RS_REARM_SEEN:-}"
  local status_field="${RS_STATUS:-completed}"
  local base_sha="${RS_BASESHA:-basesha000000}"
  local head_field="${RS_HEADSHA:-$base_sha}"
  local live_url=""
  local branch_field=""
  [ -n "${RS_HEADBRANCH:-}" ] && branch_field=",\"headBranch\":\"$RS_HEADBRANCH\""
  local dir; dir="$(mktemp -d)"
  GH_LOG="$dir/gh-calls.log"
  : > "$GH_LOG"
  printf '%s\n' "${RS_PRS:-[]}" > "$dir/prs.json"
  printf '%s\n' "${RS_VIEW:-{\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}}" > "$dir/view.json"
  printf '%b\n' "${RS_REDJOBS:-Some Red Job}" > "$dir/redjobs.txt"
  printf '{"author_association":"%s","user":{"login":"author1"},"head":{"sha":"headsha0001"}}\n' "${RS_ASSOC:-MEMBER}" > "$dir/assoc.txt"
  # The author's permission on the repo, as the real gh --jq '.permission'
  # would print it. Default "read": an outside PR stays outside.
  printf '%s\n' "${RS_PERM:-read}" > "$dir/perm.txt"
  local reviews="${RS_REVIEWS:-}"
  [ -n "$reviews" ] || reviews='[]'
  printf '%s\n' "$reviews" > "$dir/reviews.json"
  # Not `${RS_COMMITS:-{...}}`: the first `}` inside closes the expansion.
  local commits="${RS_COMMITS:-}"
  [ -n "$commits" ] || commits='{"commits":[]}'
  printf '%s\n' "$commits" > "$dir/commits.json"
  if [ -n "${RS_LIVE:-}" ]; then
    live_url="https://fixture.invalid/api/health"
    printf '%s\n' "$RS_LIVE" > "$dir/live.json"
    # A fake curl, like the fake gh: the sweep must never reach the network,
    # and "unreachable" has to be a state the test can put it in.
    cat > "$dir/curl" <<CURL
#!/usr/bin/env bash
if [ "\$(cat "$dir/live.json")" = UNREACHABLE ]; then echo "curl: (28) timed out" >&2; exit 28; fi
cat "$dir/live.json"
CURL
    chmod +x "$dir/curl"
  fi
  RS_BASESHA=""; RS_LIVE=""; RS_HEADBRANCH=""
  RS_STATUS=""; RS_HEADSHA=""; RS_PRS=""; RS_VIEW=""; RS_REDJOBS=""; RS_REARM_SEEN=""; RS_ASSOC=""; RS_COMMITS=""; RS_REVIEWS=""; RS_PERM=""

  cat > "$dir/gh" <<FAKE
#!/usr/bin/env bash
ARGS="\$*"
echo "\$ARGS" >> "$GH_LOG"
case "\$ARGS" in
  *"/commits/"*)                    echo "$base_sha" ;;
  # Deploy-reconciler queries, matched BEFORE the generic CI one — ordering is
  # the only thing separating them, since all three start with "run list".
  "run list"*"--json status"*)      printf '%s\n' '$deploy_running' ;;
  "run list"*"--status success"*)   printf '%s\n' '$deployed_sha' ;;
  # Re-arm guard: the CI runs already on the base tip (push-triggered).
  "run list"*"--json headSha"*)     printf '%s\n' '$rearm_seen' ;;
  "run list"*)                      printf '%s\n' '{"databaseId":42,"status":"$status_field","conclusion":"$conclusion","headSha":"$head_field"$branch_field}' ;;
  *"/actions/runs/"*"/jobs"*)       printf '%s\n' '$failed_steps' ;;
  "run rerun"*)                     echo "rerun dispatched" ;;
  *"/actions/runs/"*)               printf '%s\n' '$attempt' ;;
  "run view"*)                      cat "$dir/redjobs.txt" ;;
  # The deadlock-name block also calls pr list, with a --jq the real gh would
  # apply; this fake returns the raw payload either way, which that block only
  # ever prints. The MERGE loop parses it with real jq, so fixtures must be
  # well-formed JSON.
  "pr list"*)                       cat "$dir/prs.json" ;;
  # The DCO gate: who opened the PR, and what its commits say.
  # The review list, matched BEFORE the pull itself: both paths start the same.
  "api repos/"*"/pulls/"*"/reviews"*) cat "$dir/reviews.json" ;;
  "api repos/"*"/collaborators/"*"/permission"*) cat "$dir/perm.txt" ;;
  "api repos/"*"/pulls/"*)          cat "$dir/assoc.txt" ;;
  "pr view"*"--json commits"*)      cat "$dir/commits.json" ;;
  "pr view"*)                       cat "$dir/view.json" ;;
  "pr merge"*)                      echo "merged" ;;
  "api -X PUT"*"update-branch"*)    echo "updated" ;;
  "workflow run"*)                  echo "dispatched" ;;
  *) echo "UNHANDLED gh call: \$ARGS" >&2; exit 1 ;;
esac
FAKE
  chmod +x "$dir/gh"

  local out status
  out=$(PATH="$dir:$PATH" GH_REPO=bitbaum/fixture BASE_BRANCH=main \
        DEPLOY_WORKFLOW="$deploy_wf" LIVE_COMMIT_URL="$live_url" \
        bash "$SWEEP" 2>&1)
  status=$?
  SWEEP_OUT="$out"
  if [ "$status" -ne 0 ]; then
    no "sweep exited $status — the fake gh hit an unhandled call shape, so every assertion would be vacuous"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -5
    return 1
  fi
  return 0
}

# `grep -c` PRINTS 0 and also EXITS 1 when there is no match, so the obvious
# `|| echo 0` appends a second zero and every numeric comparison then dies with
# "integer expected". Let grep's own output stand.
reruns() { grep -c '^run rerun' "$GH_LOG" 2>/dev/null; }

echo "auto-merge sweep — base branch guard"

# 1. A cancelled base run is NOT a verdict about the code. Treating it as one
#    strands the queue, and only a merge can produce a new base run — so the
#    guard blocks the very thing that would clear it.
if run_sweep cancelled '' 1; then
  [ "$(reruns)" -ge 1 ] \
    && ok 're-runs a CANCELLED base run instead of deadlocking behind it' \
    || no 're-runs a CANCELLED base run instead of deadlocking behind it'
fi

# 2. A run that failed inside GitHub's own "Set up job" never executed our code.
if run_sweep failure 'Set up job' 1; then
  [ "$(reruns)" -ge 1 ] \
    && ok 're-runs a base run that FAILED before executing any of our code' \
    || no 're-runs a base run that FAILED before executing any of our code'
fi

# 3. A genuine failure IS a verdict. It must block, and must NOT be re-run —
#    retrying real failures is how a broken base gets merged onto anyway.
if run_sweep failure 'Run tests' 1; then
  if [ "$(reruns)" -eq 0 ]; then
    ok 'refuses a genuinely broken base, and does NOT re-run it'
  else
    no 'refuses a genuinely broken base, and does NOT re-run it'
  fi
fi

# 4. Jobs API returning nothing must not be read as "infra failure" — absence of
#    evidence is not evidence of an incident.
if run_sweep failure '' 1; then
  [ "$(reruns)" -eq 0 ] \
    && ok 'does not re-run a real failure even when the jobs API says nothing' \
    || no 'does not re-run a real failure even when the jobs API says nothing'
fi

# 5. Bounded. An endlessly-failing run must not become an infinite re-run loop
#    billing Actions minutes forever.
if run_sweep cancelled '' 3; then
  if [ "$(reruns)" -eq 0 ]; then
    ok 'stops retrying once the run hits the attempt cap'
  else
    no 'stops retrying once the run hits the attempt cap'
  fi
fi

# 6. The happy path still reaches the PR loop — a guard that never lets anything
#    through is just an outage with better manners.
if run_sweep success '' 1; then
  case "$SWEEP_OUT" in
    *"no open PRs"*) ok 'proceeds to the PR loop when the base is green' ;;
    *) no "proceeds to the PR loop when the base is green (got: $(printf '%s' "$SWEEP_OUT" | tail -1))" ;;
  esac
fi

echo "auto-merge sweep — deploy reconciler"

deploys() { grep -c '^workflow run deploy.yml' "$GH_LOG" 2>/dev/null; }

# 7. OFF BY DEFAULT. A repo that sets no DEPLOY_WORKFLOW must behave exactly as
#    before — adopting a reconciler must never start firing deploys in repos
#    that never asked for one.
if run_sweep success '' 1 '' '' 0; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'is inert when DEPLOY_WORKFLOW is unset' \
    || no 'is inert when DEPLOY_WORKFLOW is unset'
fi

# 8. Drifted: green tip, last successful deploy is an older sha → ship.
if run_sweep success '' 1 deploy.yml oldsha00 0; then
  [ "$(deploys)" -ge 1 ] \
    && ok 'ships a green tip that is not yet deployed' \
    || no 'ships a green tip that is not yet deployed'
fi

# 9. Already live → do nothing. Re-dispatching every sweep would deploy the same
#    commit forever, every ten minutes.
if run_sweep success '' 1 deploy.yml basesha000000 0; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'does not re-deploy a tip that is already live' \
    || no 'does not re-deploy a tip that is already live'
fi

# 10. A deploy already in flight → do not stack another on top of it.
if run_sweep success '' 1 deploy.yml oldsha00 2; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'does not dispatch while a deploy is already in flight' \
    || no 'does not dispatch while a deploy is already in flight'
fi

# 11. THE ONE THAT MATTERS. This script does not exit on a red base — it lets a
#     PR that repairs the base through — so the reconciler must refuse to ship a
#     failing tip. The variant this code came from exited on red, which made the
#     guard invisible; the same lines here without it would deploy red.
if run_sweep failure 'Run tests' 1 deploy.yml oldsha00 0; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'NEVER ships a red base, even though the sweep continues past one' \
    || no 'NEVER ships a red base, even though the sweep continues past one'
fi

echo "auto-merge sweep — deploy reconciler, live commit"
# A run's headSha is GitHub's LABEL, not what shipped: a workflow_run-triggered
# Deploy is labelled with the default branch's tip at trigger time. On loki
# 2026-09-25 run 36135832127 shipped f2f6206 but read 4622869, and the
# reconciler, trusting the label, never dispatched. LIVE_COMMIT_URL asks the
# app instead.
TIP=4622869aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
OLD=f2f6206bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# 11a. The app reports the tip -> already deployed, nothing dispatched.
if RS_BASESHA=$TIP RS_LIVE="{\"ok\":true,\"commit\":\"$TIP\"}" run_sweep success '' 1 deploy.yml "$OLD" 0; then
  [ "$(deploys)" -eq 0 ] && grep -q 'already deployed (live)' <<<"$SWEEP_OUT" \
    && ok 'live commit == tip: already deployed, no dispatch, even when the run label is stale' \
    || no 'live commit == tip: already deployed, no dispatch, even when the run label is stale'
fi

# 11b. THE INCIDENT. The run label claims the tip; the app serves the older
#      commit. The label must lose.
if RS_BASESHA=$TIP RS_LIVE="{\"ok\":true,\"commit\":\"$OLD\"}" run_sweep success '' 1 deploy.yml "$TIP" 0; then
  [ "$(deploys)" -ge 1 ] && grep -q 'deployed commit source: live' <<<"$SWEEP_OUT" \
    && ok 'ships when the app serves an older commit although the last run is LABELLED with the tip' \
    || no 'ships when the app serves an older commit although the last run is LABELLED with the tip'
fi

# 11c. Unknown is not deployed: an unreachable app must not read as "current".
if RS_BASESHA=$TIP RS_LIVE=UNREACHABLE run_sweep success '' 1 deploy.yml "$TIP" 0; then
  [ "$(deploys)" -ge 1 ] && grep -q 'live commit UNKNOWN' <<<"$SWEEP_OUT" \
    && ok 'an unreachable live URL counts as not deployed, and dispatches' \
    || no 'an unreachable live URL counts as not deployed, and dispatches'
fi

# 11d. A short or missing commit is unknown too: a prefix is not proof.
if RS_BASESHA=$TIP RS_LIVE="{\"ok\":true,\"commit\":\"${TIP:0:7}\"}" run_sweep success '' 1 deploy.yml "$TIP" 0; then
  [ "$(deploys)" -ge 1 ] \
    && ok 'a non-40-hex live commit counts as not deployed' \
    || no 'a non-40-hex live commit counts as not deployed'
fi

# 11e. Unknown still waits for a deploy in flight: not a licence to stack.
if RS_BASESHA=$TIP RS_LIVE=UNREACHABLE run_sweep success '' 1 deploy.yml "$TIP" 1; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'an unreachable live URL still does not dispatch over a deploy in flight' \
    || no 'an unreachable live URL still does not dispatch over a deploy in flight'
fi

# 11f. Unknown never ships a red base.
if RS_BASESHA=$TIP RS_LIVE=UNREACHABLE run_sweep failure 'Run tests' 1 deploy.yml "$TIP" 0; then
  [ "$(deploys)" -eq 0 ] \
    && ok 'an unreachable live URL never ships a red base' \
    || no 'an unreachable live URL never ships a red base'
fi

# 11g. Unset: the old behaviour exactly; the label decides.
if RS_BASESHA=$TIP run_sweep success '' 1 deploy.yml "$TIP" 0; then
  [ "$(deploys)" -eq 0 ] && grep -q 'source: last run label' <<<"$SWEEP_OUT" \
    && ok 'unset LIVE_COMMIT_URL: the run label decides, as before' \
    || no 'unset LIVE_COMMIT_URL: the run label decides, as before'
fi

echo "auto-merge sweep — coverage ported from orangecat"
# orangecat was the other repo with sweep tests, and converting it to the
# canonical deletes them. These are the cases its suite had that this one did
# not — moved here BEFORE the deletion, so no assertion is ever lost between
# the two commits.

merges() { grep -c '^pr merge' "$GH_LOG" 2>/dev/null; }
rearms() { grep -c '^workflow run ci.yml' "$GH_LOG" 2>/dev/null; }

# 12. A base run still in progress is not a verdict either way — defer, and do
#     NOT re-run it (re-running an in-flight run would cancel it).
if RS_STATUS=in_progress run_sweep '' '' 1; then
  if grep -q 'still running' <<<"$SWEEP_OUT" && [ "$(reruns)" -eq 0 ]; then
    ok 'defers while the base run is still going, without re-running it'
  else
    no 'defers while the base run is still going, without re-running it'
  fi
fi

# 13. The newest base CI run belonging to an OLDER commit means the current tip
#     is unjudged. Merging on that green would batch unverified commits — the
#     exact thing one-car-per-sweep exists to prevent. Never merge here.
#
#     Two cases since the deadlock fix (see "THE DEADLOCK THIS GUARD BUILDS FOR
#     ITSELF" in the sweep). This test was written before it, asserted "wait"
#     for BOTH, and went stale unseen because the suite's verdict was
#     discarded (see the end of this file).
#
#   13a. A run IS in flight: CI is coming — wait for it, dispatch nothing.
if RS_STATUS=in_progress RS_HEADSHA=oldsha000 run_sweep success '' 1; then
  grep -q 'waiting for CI to catch up' <<<"$SWEEP_OUT" && [ "$(merges)" -eq 0 ] && [ "$(rearms)" -eq 0 ] \
    && ok 'waits, without dispatching, while a run for an older commit is still in flight' \
    || no 'waits, without dispatching, while a run for an older commit is still in flight'
fi
#   13b. Nothing in flight: nothing will ever judge the tip (an automated
#        merge emits no workflow events), so dispatch CI — and still not merge.
if RS_HEADSHA=oldsha000 run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] && [ "$(rearms)" -ge 1 ] \
    && ok 'dispatches CI, and does not merge, when the tip has no run and none is in flight' \
    || no 'dispatches CI, and does not merge, when the tip has no run and none is in flight'
fi

#   13c. A run for the tip's sha on ANOTHER branch (a PR's run) is not the
#        base's verdict. The sweep filters the branch itself because it may
#        not ask GitHub to (see 13d).
if RS_HEADBRANCH=some-pr-branch run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] && [ "$(rearms)" -ge 1 ] \
    && ok 'a run for the tip on another branch does not count as the base verdict' \
    || no 'a run for the tip on another branch does not count as the base verdict'
fi
#   13d. No run query may pass --branch. GitHub serves branch-filtered run
#        lists from an intermittently weeks-stale index; on loki 2026-09-25
#        that made every sweep dispatch CI, cancelling the run in flight, in
#        a ~3-minute loop. The unfiltered list is fresh.
if RS_HEADBRANCH=main RS_PRS="$(printf '[{"number":7,"title":"t","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","labels":[],"createdAt":"2026-01-01T00:00:00Z","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","name":"lint"}]}]')" \
   run_sweep success '' 1 deploy.yml oldsha00 0; then
  [ "$(grep -c '^run list.*--branch' "$GH_LOG")" -eq 0 ] && [ "$(merges)" -ge 1 ] \
    && ok 'no run list call filters by --branch, and a base run on main still merges' \
    || no 'no run list call filters by --branch, and a base run on main still merges'
fi

# A PR fixture generator for the red-base carve-out. The rollup names decide
# everything: the base fails 'Some Red Job', and whether this PR proves that
# job green is the whole question.
pr_fixture() { # <rollup-check-names, comma-separated>
  local checks="" name
  local IFS=','
  for name in $1; do
    checks="${checks:+$checks,}{\"status\":\"COMPLETED\",\"conclusion\":\"SUCCESS\",\"name\":\"$name\"}"
  done
  printf '[{"number":7,"title":"the fix","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"UNSTABLE","labels":[],"createdAt":"2026-01-01T00:00:00Z","statusCheckRollup":[%s]}]' "$checks"
}

# 14. THE CARVE-OUT ITSELF: a PR green on every job the base fails may merge
#     onto the red base. Its checks ran on the MERGE result, so green there is
#     direct evidence the post-merge base is better than the pre-merge base —
#     and without this, the fix is trapped behind the very redness it repairs.
if RS_PRS="$(pr_fixture 'Some Red Job,lint')" run_sweep failure 'Run tests' 1; then
  [ "$(merges)" -ge 1 ] \
    && ok 'merges a PR that is green on every job the red base fails' \
    || no 'merges a PR that is green on every job the red base fails'
fi

# 15. A PR that never RAN the failing job proves nothing about it. Letting it
#     through would merge unrelated work onto a broken base — the failure mode
#     the guard exists for.
if RS_PRS="$(pr_fixture 'lint,typecheck')" run_sweep failure 'Run tests' 1; then
  [ "$(merges)" -eq 0 ] \
    && ok 'refuses a PR that does not run the failing job at all' \
    || no 'refuses a PR that does not run the failing job at all'
fi

# 16. Covering SOME failing jobs is covering none: the uncovered one still
#     lands broken.
if RS_REDJOBS='Some Red Job\nOther Red Job' \
   RS_PRS="$(pr_fixture 'Some Red Job,lint')" run_sweep failure 'Run tests' 1; then
  [ "$(merges)" -eq 0 ] \
    && ok 'refuses a PR that covers only SOME of the failing jobs' \
    || no 'refuses a PR that covers only SOME of the failing jobs'
fi

# 17. A green base merges a green PR without ever asking which jobs failed —
#     the carve-out must be invisible on the happy path.
if RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] \
    && ok 'a green base merges normally, never consulting the carve-out' \
    || no 'a green base merges normally, never consulting the carve-out'
fi

# 18. A PAT merge already triggers CI on push. Dispatching CI on top of that run
#     put two runs on one ref and the concurrency group cancelled one — under a
#     burst of merges main's CI cancelled itself repeatedly (loki,
#     2026-09-10). When a run for the new tip exists, no re-arm.
if RS_REARM_SEEN=basesha000000 RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] && [ "$(rearms)" -eq 0 ] \
    && ok 'does not re-arm CI when a run for the new tip already exists' \
    || no 'does not re-arm CI when a run for the new tip already exists'
fi

# 19. A GITHUB_TOKEN merge triggers nothing; the re-arm is what makes it ship.
if RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] && [ "$(rearms)" -eq 1 ] \
    && ok 're-arms CI exactly once when no run for the new tip exists' \
    || no 're-arms CI exactly once when no run for the new tip exists'
fi

echo "auto-merge sweep — the contributor gate"

signed()   { printf '{"oid":"%s","messageBody":"some work\\n\\nSigned-off-by: Ada Outsider <ada@example.org>"}' "$1"; }
unsigned() { printf '{"oid":"%s","messageBody":"some work"}' "$1"; }
approval() { printf '[{"state":"APPROVED","commit_id":"%s","author_association":"%s"}]' "$1" "$2"; }

# 19. An outside PR whose commit carries no sign-off is left alone, and the
#     sweep says which commit, so the contributor knows what to add.
if RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(unsigned aaaaaaaa11111111)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] && grep -q 'without a Signed-off-by.*aaaaaaaa' <<<"$SWEEP_OUT" \
    && ok 'an outside PR without a sign-off is not merged, and the commit is named' \
    || no 'an outside PR without a sign-off is not merged, and the commit is named'
fi

# 20. One signed commit does not cover an unsigned one: EVERY commit certifies.
if RS_ASSOC=FIRST_TIME_CONTRIBUTOR RS_COMMITS="{\"commits\":[$(signed bbbbbbbb22222222),$(unsigned cccccccc33333333)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] && grep -q 'cccccccc' <<<"$SWEEP_OUT" && ! grep -q 'bbbbbbbb' <<<"$SWEEP_OUT" \
    && ok 'a partly signed outside PR is held, naming only the unsigned commit' \
    || no 'a partly signed outside PR is held, naming only the unsigned commit'
fi

# 21. Every commit signed off: the outside PR merges like any other.
if RS_REVIEWS="$(approval headsha0001 MEMBER)" RS_ASSOC=NONE RS_COMMITS="{\"commits\":[$(signed dddddddd44444444),$(signed eeeeeeee55555555)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] \
    && ok 'an outside PR, signed off and approved by a maintainer on its head, merges' \
    || no 'an outside PR, signed off and approved by a maintainer on its head, merges'
fi

# 22. A member's PR never needs a sign-off — agents commit under Cato's own
#     identity with Co-Authored-By, and the copyright holder cannot certify
#     to themself. Test 17 already merges a MEMBER PR; this one says so with
#     an explicitly unsigned commit.
if RS_ASSOC=MEMBER RS_COMMITS="{\"commits\":[$(unsigned ffffffff66666666)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] \
    && ok 'a member PR merges without a sign-off' \
    || no 'a member PR merges without a sign-off'
fi

# 23. REQUIRE_DCO=0 switches the gate off for a repo with its own terms.
if REQUIRE_DCO=0 RS_REVIEWS="$(approval headsha0001 MEMBER)" RS_ASSOC=NONE RS_COMMITS="{\"commits\":[$(unsigned 9999999977777777)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -ge 1 ] \
    && ok 'REQUIRE_DCO=0 disables the gate' \
    || no 'REQUIRE_DCO=0 disables the gate'
fi


echo "auto-merge sweep — outside PRs need a maintainer's review"

# 24. Signed off is not reviewed. The contributor terms are about licensing;
#     they say nothing about whether code is safe to run, and every repo this
#     sweep serves deploys on merge.
if RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(signed abababab11111111)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] && grep -q 'no approving review' <<<"$SWEEP_OUT" \
    && ok 'a signed-off outside PR with no review is held, and says why' \
    || no 'a signed-off outside PR with no review is held, and says why'
fi

# 25. An approval on an older commit does not cover the one being merged —
#     otherwise a contributor gets v1 approved and pushes v2.
if RS_REVIEWS="$(approval oldsha0000 MEMBER)" RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(signed cdcdcdcd22222222)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] \
    && ok 'an approval on an older commit does not merge the new head' \
    || no 'an approval on an older commit does not merge the new head'
fi

# 26. Only a maintainer's approval counts — anyone can press Approve.
if RS_REVIEWS="$(approval headsha0001 CONTRIBUTOR)" RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(signed efefefef33333333)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] \
    && ok 'an approval from a non-maintainer does not count' \
    || no 'an approval from a non-maintainer does not count'
fi

# 27. Switching the licence terms off must not switch review off: separate
#     properties, separate switches.
if REQUIRE_DCO=0 RS_ASSOC=NONE RS_COMMITS="{\"commits\":[$(unsigned 1212121244444444)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 0 ] \
    && ok 'REQUIRE_DCO=0 still requires a maintainer review for an outside PR' \
    || no 'REQUIRE_DCO=0 still requires a maintainer review for an outside PR'
fi

# 28. A private repo's sweep runs on the default token, which cannot see
#     PRIVATE org membership, so the owner's own agent reads as CONTRIBUTOR
#     (bitbaum/farmhouse#2, 2026-09-26). Write access to the repo is the
#     real question, and it answers yes: merge, no review of oneself.
if RS_PERM=admin RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(unsigned 9a9a9a9a55555555)]}" \
   RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
  [ "$(merges)" -eq 1 ] && grep -q 'has admin access' <<<"$SWEEP_OUT" \
    && ok 'an author with write access is not an outside PR, whatever the association says' \
    || no 'an author with write access is not an outside PR, whatever the association says'
fi
for p in read none ''; do
  if RS_PERM="$p" RS_ASSOC=CONTRIBUTOR RS_COMMITS="{\"commits\":[$(signed 8b8b8b8b66666666)]}" \
     RS_PRS="$(pr_fixture 'lint')" run_sweep success '' 1; then
    [ "$(merges)" -eq 0 ] \
      && ok "permission '${p:-unreadable}' leaves an outside PR outside" \
      || no "permission '${p:-unreadable}' let an outside PR merge unreviewed"
  fi
done

# (The verdict used to sit HERE, with ~70 lines of tests appended after it.
# A script's exit status is its LAST command's, so `[ "$FAIL" -eq 0 ]` was
# discarded and this suite exited 0 while printing "27 passed, 1 failed" —
# which is how test 13 below sat stale on main unseen. It lives at the end now.)

# ── The base run that speaks for the commit ────────────────────────────────
# A duplicate run on the same ref is cancelled by the concurrency group. When
# that cancelled run is the newest, judging the base from it burns three rerun
# attempts and then defers forever — while a SUCCESSFUL run for the very same
# commit sits beside it, ignored (2026-09-11: the stranded PR was #44, the fix
# for the cancellation itself).
# Not a copy: the sweep's own function, so the two cannot drift.
eval "$(awk '/^pick_base_run\(\) \{/,/^\}/' "$SWEEP")"

grep -q 'pick_base_run "$base_sha"' "$SWEEP" \
  || no 'the sweep selects its base run through pick_base_run'

run='{"databaseId":%s,"status":"completed","conclusion":"%s","headSha":"%s"}'
cancelled_then_success="[$(printf "$run" 1 cancelled tip),$(printf "$run" 2 success tip)]"
[ "$(printf '%s' "$cancelled_then_success" | pick_base_run tip | jq -r .conclusion)" = success ] \
  && ok 'a success for the base commit outranks a cancelled sibling' \
  || no 'a success for the base commit outranks a cancelled sibling'

[ "$(printf '%s' "[$(printf "$run" 1 cancelled tip)]" | pick_base_run tip | jq -r .conclusion)" = cancelled ] \
  && ok 'a lone cancelled run is still returned, so the rerun path keeps working' \
  || no 'a lone cancelled run is still returned, so the rerun path keeps working'

[ "$(printf '%s' "[$(printf "$run" 1 cancelled tip),$(printf "$run" 2 failure tip)]" | pick_base_run tip | jq -r .conclusion)" = failure ] \
  && ok 'a real failure is not hidden by a cancelled sibling' \
  || no 'a real failure is not hidden by a cancelled sibling'

[ "$(printf '%s' "[$(printf "$run" 1 success older)]" | pick_base_run tip | jq -r .headSha)" = older ] \
  && ok 'with no run for the tip, the newest run is returned so the catch-up check fires' \
  || no 'with no run for the tip, the newest run is returned so the catch-up check fires'

# ── Superseded is not un-judged ────────────────────────────────────────────
# A cancelled run with a LIVE sibling on the same commit was superseded by it.
# Re-running it cancels that sibling (same concurrency group), the next sweep
# calls the sibling un-judged and re-runs it, cancelling the first — the two
# take turns until the attempt cap. Measured on bitbaum/solon 2026-09-17: six
# sweeps a minute apart alternating between two ci.yml runs on 2667beb, ending
# at attempt 3 on both, with the Deploy gate failing on a docs-only change each
# time. It terminates by exhaustion, not by resolving.
eval "$(awk '/^sibling_run_in_flight\(\) \{/,/^\}/' "$SWEEP")"

grep -q 'sibling_run_in_flight "$base_runs_json"' "$SWEEP" \
  || no 'the sweep consults sibling_run_in_flight before re-running the base'

live='{"databaseId":%s,"status":"in_progress","conclusion":null,"headSha":"%s"}'
both="[$(printf "$run" 1 cancelled tip),$(printf "$live" 2 tip)]"
sibling_run_in_flight "$both" tip 1 \
  && ok 'a cancelled run with a live sibling on the same sha is superseded' \
  || no 'a cancelled run with a live sibling on the same sha is superseded'

# ...and the guard must NOT swallow the case the rerun path exists for.
lone="[$(printf "$run" 1 cancelled tip)]"
sibling_run_in_flight "$lone" tip 1 \
  && no 'a LONE cancelled run must still be re-run, not treated as superseded' \
  || ok 'a lone cancelled run is not superseded, so the rerun path keeps working'

# a live run on a DIFFERENT commit is not this commit's sibling
other="[$(printf "$run" 1 cancelled tip),$(printf "$live" 2 older)]"
sibling_run_in_flight "$other" tip 1 \
  && no 'a live run on another sha must not count as a sibling' \
  || ok 'a live run on another sha is not a sibling'

# a COMPLETED sibling is not in flight — nothing will arrive from it
done_sib="[$(printf "$run" 1 cancelled tip),$(printf "$run" 2 cancelled tip)]"
sibling_run_in_flight "$done_sib" tip 1 \
  && no 'two completed cancelled runs must not read as in flight' \
  || ok 'a completed sibling does not count as in flight'

# the run must not be its own sibling
self="[$(printf "$live" 1 tip)]"
sibling_run_in_flight "$self" tip 1 \
  && no 'a run must not be its own in-flight sibling' \
  || ok 'a run is not its own sibling'

# ── Verdict: LAST, so it counts every test above and IS the exit status ──────
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
