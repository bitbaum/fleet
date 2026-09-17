#!/usr/bin/env bash
# Run the response scanner across every LIVE app, unauthenticated.
#
# secret-in-response.py has existed since 2026-09-15 with a README that says
# "Exit code is 1 if anything CRITICAL or HIGH was found, so it can gate CI",
# a 9-case test suite covering both directions, and a real cross-account
# disclosure to its name (vitareba's GET /api/admin/patients returning every
# patient's bcrypt digest). NOTHING RAN IT. Not a workflow, not ci.yml, not
# even its test.
#
# That is Rung 5 — the rung templates/ci/README.md calls the one that catches
# what actually costs this fleet — existing as dead code. The floor audit has a
# name for the shape: UNCALLED. Here it applied to the highest-value gate in
# the repo, which is the one place it costs the most.
#
# WHY UNAUTHENTICATED ONLY.
#
# The README is explicit that the authenticated pass is "the real test" — most
# interesting routes 401 without a session. This sweep deliberately does NOT do
# that half, because it would need a live session cookie per app held as a
# secret, and a gate that needs twelve rotating credentials to run is a gate
# that will stop running. What it DOES cover is the strictly worse class: a
# secret reachable with no login at all, by anyone, right now. vitareba's leak
# was behind a login; the class this catches is the one where it is not.
#
# So this is the floor of Rung 5, not its ceiling, and the file says so rather
# than letting a green run imply more than it proves. The authenticated pass
# stays a manual step until the sessions exist to automate it.
#
# READS THE REGISTER, NEVER A LOCAL CHECKOUT. The live-app list is
# loki:scripts/hetzner/apps.conf, fetched from its default branch — a local
# copy is stale by construction and a sweep over stale hosts silently stops
# covering whatever moved.

set -uo pipefail

OWNER="${OWNER:-bitbaum}"
APPS_REPO="${APPS_REPO:-loki}"
APPS_PATH="${APPS_PATH:-scripts/hetzner/apps.conf}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so the AGGREGATION can be tested without the network. The
# detector has its own 9-case suite; what needs proving here is different and
# was never covered: that a finding reaches exit 1, that a host we could not
# reach is withheld rather than counted clean, and that an unreadable register
# refuses to report a clean sweep. A rule that can only be exercised by a live
# call is a rule nobody re-tests — this repo's own words, twice.
SCANNER="${SCANNER:-$HERE/secret-in-response.py}"
SCANNER_CMD="${SCANNER_CMD:-python3}"

# Paths every app can be asked for without side effects. GET only — the scanner
# never writes — and deliberately short: this is a daily sweep over a dozen
# hosts, not a crawler.
PATHS="${PATHS:-/ /login /api/health}"

[ -f "$SCANNER" ] || { echo "✗ scanner not found at $SCANNER" >&2; exit 2; }

conf=$(gh api "repos/${OWNER}/${APPS_REPO}/contents/${APPS_PATH}" --jq '.content' 2>/dev/null \
        | tr -d '\n' | base64 -d 2>/dev/null)
if [ -z "$conf" ]; then
  # A failed read is not an empty fleet. Reporting "0 apps, all clean" from an
  # outage is the audit's own worst bug, already documented twice in this repo.
  echo "✗ could not read ${APPS_REPO}:${APPS_PATH} — refusing to report a clean sweep over an empty list" >&2
  exit 2
fi

# name|port|domains|... ; status is field 9. First domain only: the others are
# aliases onto the same app and scanning both doubles the cost for one answer.
mapfile -t rows < <(printf '%s\n' "$conf" \
  | awk -F'|' '!/^[[:space:]]*#/ && NF > 8 && $9 == "live" && $3 != "-" && $3 != "" {
      split($3, d, ","); print $1 "\t" d[1]
    }')

[ "${#rows[@]}" -gt 0 ] || { echo "✗ no live apps parsed from ${APPS_PATH} — the format changed" >&2; exit 2; }

echo "secret-in-response sweep — ${#rows[@]} live app(s), unauthenticated"
echo "paths: ${PATHS}"
echo

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
findings=0; unreachable=(); scanned=0

for row in "${rows[@]}"; do
  name="${row%%$'\t'*}"; host="${row##*$'\t'}"
  out="$tmp/${name}.json"
  # shellcheck disable=SC2086
  if ! text=$($SCANNER_CMD "$SCANNER" --base "https://${host}" --paths $PATHS \
                --json-out "$out" 2>&1); then
    rc=$?
  else
    rc=0
  fi

  n=0
  [ -s "$out" ] && n=$(jq 'length' "$out" 2>/dev/null || echo 0)

  # rc=1 means the scanner found CRITICAL/HIGH. Any other non-zero, or no JSON
  # written at all, means it could not complete — that is a failure to LOOK and
  # is withheld rather than charged to the app.
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
    unreachable+=("$name ($host)")
    printf "  ?  %-16s could not scan — withheld\n" "$name"
    continue
  fi
  if [ ! -f "$out" ]; then
    unreachable+=("$name ($host)")
    printf "  ?  %-16s no result written — withheld\n" "$name"
    continue
  fi

  scanned=$((scanned + 1))
  if [ "$n" -gt 0 ]; then
    findings=$((findings + n))
    printf "  ✗  %-16s %s finding(s) on %s\n" "$name" "$n" "$host"
    jq -r '.[] | "       \(.severity)  \(.path)  key=\(.key // "?")"' "$out" 2>/dev/null
  else
    printf "  ok %-16s %s\n" "$name" "$host"
  fi
done

echo
echo "scanned ${scanned}/${#rows[@]} live app(s); ${findings} finding(s)"

if [ "${#unreachable[@]}" -gt 0 ]; then
  echo
  echo "? UNREACHABLE — could not look; withheld, NOT counted as clean:"
  printf '    %s\n' "${unreachable[@]}"
fi

if [ "$findings" -gt 0 ]; then
  echo
  echo "✗ credential material is reachable WITHOUT A LOGIN. This is the class"
  echo "  templates/ci/README.md calls Rung 5 — a gate on what the code must"
  echo "  never do, not on what it does."
  exit 1
fi

# A clean verdict may only be claimed over what was actually READ. With every
# host unreachable the loop finds nothing and the old ending announced a clean
# fleet on the strength of zero responses — the same "empty result read as a
# fact" this repo has now shipped three times. Caught by
# test-secret-in-response-sweep.sh before this ever ran on a bad day.
if [ "$scanned" -eq 0 ]; then
  echo
  echo "✗ scanned NOTHING — every live app was unreachable. This is not a clean"
  echo "  sweep, it is an absent one; refusing to report a pass over zero responses."
  exit 2
fi

echo
if [ "${#unreachable[@]}" -gt 0 ]; then
  # Say what the verdict covers, not what it feels like. "The fleet is clean"
  # and "the nine hosts I could reach are clean" are different sentences.
  echo "✓ nothing credential-shaped in the ${scanned} app(s) reached, unauthenticated"
  echo "  ${#unreachable[@]} app(s) were NOT scanned — this says nothing about them"
else
  echo "✓ nothing credential-shaped in any live app's unauthenticated responses"
fi
echo "  (the authenticated pass is the real test and is still manual — see README)"
exit 0
