#!/usr/bin/env bash
#
# Fleet audit: do the registers contradict the business facts?
#
#   business-facts-audit.sh            (reads loki's public apps.conf via raw GitHub)
#   APPS_CONF=path business-facts-audit.sh
#
# WHY: 2026-10-21 apps.conf listed Kivvi as RevampIT|client-app|favour after
# RevampIT had dropped G, and readings.json counted 4 clients because of it.
# Ownership and client status come from registers/org.json -> businessFacts;
# this fails when apps.conf owners or readings.json counts disagree. Prose in
# docs is covered by org-drift-audit.sh via org.json forbiddenClaims.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ORG="$HERE/../../registers/org.json"
READINGS="$HERE/../../registers/readings.json"
conf="$(mktemp)"; trap 'rm -f "$conf"' EXIT
if [[ -n "${APPS_CONF:-}" ]]; then cp "$APPS_CONF" "$conf"
else
  # This source file is public. Fetch the raw object so this routine audit
  # does not consume the authenticated GitHub API quota used by CI sweeps.
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    'https://raw.githubusercontent.com/bitbaum/loki/main/scripts/hetzner/apps.conf' \
    --output "$conf"
fi
python3 - "$ORG" "$READINGS" "$conf" <<'PY'
import json, sys
org, readings, conf = sys.argv[1:]
facts = json.load(open(org))["businessFacts"]
bad = {n.lower() for n in facts["notClients"]}
favours = {n.lower() for n in facts["favourClients"]}
fails = []; clients = []; fav = []
for line in open(conf):
    if not line.strip() or line.lstrip().startswith("#"): continue
    f = line.rstrip("\n").split("|")
    if len(f) < 9: continue
    app, owner, kind, state = f[0], f[6], f[7], f[8]
    pay = f[9] if len(f) > 9 else "-"
    if owner.lower() in bad:
        fails.append(f"apps.conf {app}: owner {owner} is listed in businessFacts.notClients")
    if state == "live" and owner != "bitbaum" and kind.startswith("client"):
        clients.append(app)
        if pay == "favour": fav.append((app, owner))
for app, owner in fav:
    if owner.lower() not in favours and app.lower() not in favours:
        fails.append(f"apps.conf {app}: favour client {owner} is not in businessFacts.favourClients")
r = json.load(open(readings))
c = next((v for v in r.values() if isinstance(v, dict) and "clients" in v and isinstance(v["clients"], dict)), {}).get("clients", {})
if c and c.get("favours") != len(fav):
    fails.append(f"readings.json favours={c.get('favours')} but apps.conf has {len(fav)} live favour clients")
if len(fav) != len(favours):
    fails.append(f"apps.conf has {len(fav)} favour clients {[a for a,_ in fav]}; businessFacts.favourClients lists {len(favours)}")
print(f"live client rows: {len(clients)} {clients}; favours: {len(fav)}")
for x in fails: print("✗", x)
sys.exit(1 if fails else 0)
PY
