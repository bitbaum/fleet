#!/usr/bin/env bash
#
# The fleet reconciler's clock, on the box, because GitHub's scheduler is not one.
#
# WHY THIS IS NOT A GITHUB CRON
#
# It was, and it did not run. bitbaum/fleet's `deploy-freshness.yml` carried an
# hourly `37 * * * *` for its first half-day and fired at NEITHER the 10:37 nor
# the 11:37 slot; `deploy-reconciler.yml` carried a twice-hourly schedule and
# missed 11:53 too. Every run either workflow has ever had was a manual
# dispatch.
#
# This is the same failure that broke the per-repo sweeps — measured
# 2026-09-15, time since each repo's sweep last ran was loki 19m, evig 151m,
# reparaturbonus-zh 244m, vitareba 276m, against a stated ten-minute cadence.
# Moving from twenty-five GitHub crons to one GitHub cron moved the problem
# without fixing it, and a reconciler that never fires is not a reconciler.
#
# The box's own timers DO fire, on time, every few minutes, and have for
# months: security-check every 5m, host-check every 5m, watchdog every 5m. So
# the clock lives here and GitHub only does the work.
#
# WHAT IT DELIBERATELY DOES NOT DO
#
# It holds no policy about what should ship. Every guard — green tip, nothing in
# flight, the dispatch cap, the double read, the CI-re-run rule — lives in the
# workflow this triggers, where it is version-controlled and covered by tests. A
# clock that also made decisions would be a second, untested copy of the
# reconciler living on a box nobody reads, drifting from the one that is.
set -uo pipefail

REPO="${FLEET_REPO:-bitbaum/fleet}"
WORKFLOW="${FLEET_RECONCILER_WORKFLOW:-deploy-reconciler.yml}"
LOG_TAG="fleet-reconciler-tick"

log() { logger -t "$LOG_TAG" -- "$*"; echo "$*"; }

if ! command -v gh >/dev/null 2>&1; then
  log "FAILED: gh is not on PATH; cannot dispatch ${WORKFLOW}"
  exit 1
fi

# Retry: a transient network failure here means the fleet skips a tick, and the
# next one is fifteen minutes away.
for attempt in 1 2 3; do
  if out=$(gh workflow run "$WORKFLOW" --repo "$REPO" --ref main 2>&1); then
    log "dispatched ${WORKFLOW} on ${REPO} (attempt ${attempt})"
    exit 0
  fi
  log "attempt ${attempt} failed: ${out}"
  sleep 5
done

# Never exit 0 on a failed dispatch. A tick that reports success while having
# dispatched nothing is exactly the invisible failure this whole mechanism
# exists to end: `systemctl list-timers` would show it firing happily forever.
log "FAILED: could not dispatch ${WORKFLOW} on ${REPO} after 3 attempts"
exit 1
