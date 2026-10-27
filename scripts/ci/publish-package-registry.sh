#!/usr/bin/env bash
# Recompute after a concurrent main update; never force-push generated facts.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != bitbaum/fleet ]]; then
  echo 'This writer runs only in the disposable Fleet Actions checkout.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Refusing to discard tracked checkout changes.' >&2
  exit 1
fi
: "${FLEET_DISPATCH_TOKEN:?FLEET_PAT is required for the catalogue dispatch}"
: "${REPO_ACTIONS_TOKEN:?Repository Actions token is required to re-arm CI}"
diagnostic="$(mktemp)"
trap 'rm -f "$diagnostic"' EXIT
changed=false
published=false
for attempt in 1 2 3; do
  git fetch -q origin main
  # This is an isolated CI checkout, guarded above. A retry rebuilds facts
  # against the new base rather than rebasing stale generated JSON over it.
  git reset --hard --quiet origin/main
  node scripts/ci/shared-registry-audit.mjs --emit registers/packages.json >/dev/null
  if git diff --quiet -- registers/packages.json; then
    published=true
    break
  fi
  git config user.name fleet-bot
  git config user.email noreply@bitbaum.invalid
  git add registers/packages.json
  git commit -m 'chore(registers): refresh derived package registry'
  if git push origin HEAD:refs/heads/main 2>"$diagnostic"; then
    changed=true
    published=true
    break
  fi
  cat "$diagnostic" >&2
  if ! [[ "$(cat "$diagnostic")" =~ (fetch\ first|non-fast-forward|tip\ of\ your\ current\ branch) ]]; then
    exit 1
  fi
  echo "Main advanced; recomputing registry (attempt $attempt/3)." >&2
 done
if [[ "$published" != true ]]; then
  echo 'Registry could not land after three concurrent-main retries.' >&2
  exit 1
fi
registry_sha="$(git rev-parse HEAD)"
payload="$(jq -n --arg sha "$registry_sha" '{event_type:"package-registry-updated",client_payload:{packages_sha:$sha}}')"
failures=0
# Even unchanged facts must recover a previous failed dispatch, and source
# documentation may have changed without changing the registry version.
if ! GH_TOKEN="$FLEET_DISPATCH_TOKEN" gh api --method POST repos/bitbaum/bitbaum/dispatches --input - <<< "$payload"; then
  echo 'Catalogue refresh failed; registry commit is retained for retry.' >&2
  failures=1
fi
# Both effects are independent: a catalogue failure must not strand main
# without CI after a GITHUB_TOKEN push.
if [[ "$changed" == true ]]; then
  if ! GH_TOKEN="$REPO_ACTIONS_TOKEN" gh workflow run ci.yml --ref main; then
    echo 'CI re-arm failed; merge policy must continue to hold.' >&2
    failures=1
  fi
fi
exit "$failures"
