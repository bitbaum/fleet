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
#
# Emits the sweep's combined output; records gh calls in $GH_LOG.
run_sweep() {
  local conclusion="$1" failed_steps="${2:-}" attempt="${3:-1}"
  local deploy_wf="${4:-}" deployed_sha="${5:-}" deploy_running="${6:-0}"
  local status_field="${RS_STATUS:-completed}"
  local head_field="${RS_HEADSHA:-basesha000000}"
  local dir; dir="$(mktemp -d)"
  GH_LOG="$dir/gh-calls.log"
  : > "$GH_LOG"
  printf '%s\n' "${RS_PRS:-[]}" > "$dir/prs.json"
  printf '%s\n' "${RS_VIEW:-{\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}}" > "$dir/view.json"
  printf '%b\n' "${RS_REDJOBS:-Some Red Job}" > "$dir/redjobs.txt"
  RS_STATUS=""; RS_HEADSHA=""; RS_PRS=""; RS_VIEW=""; RS_REDJOBS=""

  cat > "$dir/gh" <<FAKE
#!/usr/bin/env bash
ARGS="\$*"
echo "\$ARGS" >> "$GH_LOG"
case "\$ARGS" in
  *"/commits/"*)                    echo "basesha000000" ;;
  # Deploy-reconciler queries, matched BEFORE the generic CI one — ordering is
  # the only thing separating them, since all three start with "run list".
  "run list"*"--json status"*)      printf '%s\n' '$deploy_running' ;;
  "run list"*"--status success"*)   printf '%s\n' '$deployed_sha' ;;
  "run list"*)                      printf '%s\n' '{"databaseId":42,"status":"$status_field","conclusion":"$conclusion","headSha":"$head_field"}' ;;
  *"/actions/runs/"*"/jobs"*)       printf '%s\n' '$failed_steps' ;;
  "run rerun"*)                     echo "rerun dispatched" ;;
  *"/actions/runs/"*)               printf '%s\n' '$attempt' ;;
  "run view"*)                      cat "$dir/redjobs.txt" ;;
  # The deadlock-name block also calls pr list, with a --jq the real gh would
  # apply; this fake returns the raw payload either way, which that block only
  # ever prints. The MERGE loop parses it with real jq, so fixtures must be
  # well-formed JSON.
  "pr list"*)                       cat "$dir/prs.json" ;;
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
        DEPLOY_WORKFLOW="$deploy_wf" \
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

echo "auto-merge sweep — coverage ported from orangecat"
# orangecat was the other repo with sweep tests, and converting it to the
# canonical deletes them. These are the cases its suite had that this one did
# not — moved here BEFORE the deletion, so no assertion is ever lost between
# the two commits.

merges() { grep -c '^pr merge' "$GH_LOG" 2>/dev/null; }

# 12. A base run still in progress is not a verdict either way — defer, and do
#     NOT re-run it (re-running an in-flight run would cancel it).
if RS_STATUS=in_progress run_sweep '' '' 1; then
  if printf '%s' "$SWEEP_OUT" | grep -q 'still running' && [ "$(reruns)" -eq 0 ]; then
    ok 'defers while the base run is still going, without re-running it'
  else
    no 'defers while the base run is still going, without re-running it'
  fi
fi

# 13. The newest base CI run belonging to an OLDER commit means the current tip
#     is unjudged. Merging on that green would batch unverified commits — the
#     exact thing one-car-per-sweep exists to prevent.
if RS_HEADSHA=oldsha000 run_sweep success '' 1; then
  printf '%s' "$SWEEP_OUT" | grep -q 'waiting for CI to catch up' \
    && ok 'waits when the newest base run belongs to an older commit' \
    || no 'waits when the newest base run belongs to an older commit'
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

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
