#!/usr/bin/env bash
#
# Self-test for prune-ephemeral-repos.sh. No network, no gh, no checkout.
#
# This script's job is to choose which repos may be DELETED, so its selector is
# tested in both directions on every fixture: the marked repo must be selected,
# and every unmarked one must not be. A selector that returns everything and a
# selector that returns the right thing look identical on a fixture containing
# only prunable repos, which is why each fixture carries a repo that must
# survive it.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../local/prune-ephemeral-repos.sh"
TOPIC="fleet-ephemeral"

pass=0
fail=0

ok()  { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  ✗ %s\n' "$1" >&2; }

# Run the selector against a fixture; echoes the selected names, space-joined.
select_names() {
  printf '%s' "$1" | bash "$SCRIPT" --selftest-select "$TOPIC" 2>/dev/null | cut -f1 | tr '\n' ' ' | sed 's/ $//'
}
select_rows() {
  printf '%s' "$1" | bash "$SCRIPT" --selftest-select "$TOPIC" 2>/dev/null
}

echo "test-prune-ephemeral-repos"

# ── 1. the basic discrimination ──────────────────────────────────────────────
fx_basic='[
  {"name":"dogfood-site-sep10-1201","isArchived":false,"repositoryTopics":[{"name":"fleet-ephemeral"}]},
  {"name":"orangecat","isArchived":false,"repositoryTopics":[{"name":"nextjs"}]},
  {"name":"ai-kit","isArchived":false,"repositoryTopics":null}
]'
got=$(select_names "$fx_basic")
[ "$got" = "dogfood-site-sep10-1201" ] \
  && ok "selects the marked repo and only it" \
  || bad "expected only the marked repo, got: '$got'"

# The negative half, stated separately so it cannot be satisfied by accident.
case " $got " in
  *" orangecat "*) bad "orangecat (topics, but not the marker) was selected" ;;
  *) ok "a repo with OTHER topics is not selected" ;;
esac
case " $got " in
  *" ai-kit "*) bad "ai-kit (repositoryTopics: null) was selected" ;;
  *) ok "a repo with null topics is not selected — no crash, no false positive" ;;
esac

# ── 2. a fixture where NOTHING is marked must select nothing ─────────────────
# The vacuous case. A selector that had degraded into `.[]` passes every test
# above except this one.
fx_none='[
  {"name":"orangecat","isArchived":false,"repositoryTopics":[{"name":"nextjs"}]},
  {"name":"fleetcrown","isArchived":false,"repositoryTopics":[]}
]'
got=$(select_names "$fx_none")
[ -z "$got" ] \
  && ok "an unmarked fleet selects nothing (the selector is not 'everything')" \
  || bad "selected '$got' from a fixture with no marked repo"

# ── 3. archived state is reported, not filtered ──────────────────────────────
# Archived repos stay selectable so they can still be DELETED after archiving;
# the caller decides. Losing this would make --archive a one-way door.
fx_archived='[
  {"name":"velokiosk-sep10","isArchived":true,"repositoryTopics":[{"name":"fleet-ephemeral"}]},
  {"name":"factory-sep11-0040","isArchived":false,"repositoryTopics":[{"name":"fleet-ephemeral"}]}
]'
rows=$(select_rows "$fx_archived")
printf '%s' "$rows" | grep -q '^velokiosk-sep10	archived$' \
  && ok "an archived marked repo is kept and labelled 'archived'" \
  || bad "archived repo missing or mislabelled: $(printf '%s' "$rows" | tr '\n' '|')"
printf '%s' "$rows" | grep -q '^factory-sep11-0040	live$' \
  && ok "a live marked repo is labelled 'live'" \
  || bad "live repo missing or mislabelled"

# ── 4. the marker must match exactly ─────────────────────────────────────────
# `index()` on an array is exact-match; a substring implementation would select
# these and quietly widen the blast radius of --delete.
fx_near='[
  {"name":"near-miss-1","isArchived":false,"repositoryTopics":[{"name":"fleet-ephemeral-demo"}]},
  {"name":"near-miss-2","isArchived":false,"repositoryTopics":[{"name":"ephemeral"}]},
  {"name":"near-miss-3","isArchived":false,"repositoryTopics":[{"name":"Fleet-Ephemeral"}]}
]'
got=$(select_names "$fx_near")
[ -z "$got" ] \
  && ok "near-miss topic names are not treated as the marker" \
  || bad "a near-miss topic was selected: '$got'"

# ── 5. multiple topics, marker among them ────────────────────────────────────
fx_multi='[
  {"name":"kaffeeklappe-sep11","isArchived":false,"repositoryTopics":[{"name":"nextjs"},{"name":"fleet-ephemeral"},{"name":"demo"}]}
]'
got=$(select_names "$fx_multi")
[ "$got" = "kaffeeklappe-sep11" ] \
  && ok "the marker is found among several topics" \
  || bad "marker not found alongside other topics, got: '$got'"

# ── 6. an empty org must not error ───────────────────────────────────────────
got=$(select_names '[]')
[ -z "$got" ] && ok "an empty repo list selects nothing without erroring" \
              || bad "empty list produced: '$got'"

# ── 7. the script refuses to delete without --yes ────────────────────────────
# Driven through the whole script via the injection seam, so the guard itself
# runs — not a re-implementation of it. This is the one guard whose failure
# cannot be undone.
fx_live='[{"name":"factory-sep11-0040","isArchived":false,"repositoryTopics":[{"name":"fleet-ephemeral"}]}]'
out=$(FLEET_REPO_LIST_JSON="$fx_live" bash "$SCRIPT" --delete </dev/null 2>&1 || true)
case "$out" in
  *"refusing to delete without --yes"*) ok "--delete without --yes refuses" ;;
  *) bad "--delete without --yes did not refuse; got: $(printf '%s' "$out" | tr '\n' '|')" ;;
esac

# It must still SHOW what it would have deleted — a refusal that prints nothing
# teaches the caller to reach for --yes blind.
case "$out" in
  *"factory-sep11-0040"*) ok "the refusal still lists what would have been deleted" ;;
  *) bad "the refusal hid the target list" ;;
esac

# ── 8. an unmarked org reports 'nothing to do', not silence ──────────────────
# Empty and could-not-look must not read the same. This repo has been bitten by
# that difference before.
out=$(FLEET_REPO_LIST_JSON="$fx_none" bash "$SCRIPT" </dev/null 2>&1 || true)
case "$out" in
  *"no repos in"*"carry the"*) ok "an unmarked org says so explicitly, with a scanned count" ;;
  *) bad "empty result was not reported explicitly; got: $(printf '%s' "$out" | tr '\n' '|')" ;;
esac
case "$out" in
  *"scanned 2"*) ok "the empty report states how many repos it actually looked at" ;;
  *) bad "the empty report did not say how many repos it scanned" ;;
esac

# ── 9. listing is read-only ──────────────────────────────────────────────────
# The default path must never name a mutating gh subcommand.
out=$(FLEET_REPO_LIST_JSON="$fx_live" bash "$SCRIPT" </dev/null 2>&1 || true)
case "$out" in
  *"read-only"*) ok "the default action announces itself as read-only" ;;
  *) bad "default run did not announce read-only" ;;
esac

echo
echo "test-prune-ephemeral-repos: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
