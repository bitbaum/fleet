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

echo "installed. next run:"
systemctl list-timers fleet-reconciler.timer --no-pager
