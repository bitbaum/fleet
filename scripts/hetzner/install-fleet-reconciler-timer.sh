#!/usr/bin/env bash
#
# Install the fleet reconciler's clock on the box. Idempotent — safe to re-run
# after editing the script or the units.
#
#   scp the repo to the box (or run from a checkout on it), then:
#     sudo bash scripts/hetzner/install-fleet-reconciler-timer.sh
#
# Verify afterwards:
#     systemctl list-timers fleet-reconciler.timer
#     journalctl -t fleet-reconciler-tick -n 20
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

install -d -m 0755 /opt/fleet
install -m 0755 "$here/deploy-reconciler-tick.sh" /opt/fleet/deploy-reconciler-tick.sh
install -m 0644 "$here/fleet-reconciler.service" /etc/systemd/system/fleet-reconciler.service
install -m 0644 "$here/fleet-reconciler.timer"   /etc/systemd/system/fleet-reconciler.timer

systemctl daemon-reload
systemctl enable --now fleet-reconciler.timer

# A timer that reports active+enabled and has NO next elapse is the failure this
# whole mechanism exists to end, and the first version of this unit did exactly
# that after a stop/start: monotonic triggers (OnBootSec/OnUnitActiveSec) left
# NextElapseUSecMonotonic=infinity while systemctl cheerfully said "active".
# Never let the installer report success without proving the thing will tick.
# Retried, because the property is not populated the instant `enable --now`
# returns and a guard that false-alarms is a guard that gets ignored.
next_elapse=""
for _ in 1 2 3 4 5; do
  next_elapse="$(systemctl show fleet-reconciler.timer -p NextElapseUSecRealtime --value)"
  [ -n "$next_elapse" ] && [ "$next_elapse" != "n/a" ] && break
  sleep 1
done
if [ -z "$next_elapse" ] || [ "$next_elapse" = "n/a" ]; then
  echo "FAILED: the timer is installed but has NO next elapse — it would never fire." >&2
  systemctl show fleet-reconciler.timer -p NextElapseUSecRealtime -p NextElapseUSecMonotonic >&2
  exit 1
fi

echo "installed, and it will tick. next run:"
systemctl list-timers fleet-reconciler.timer --no-pager
