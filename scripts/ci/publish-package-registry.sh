#!/usr/bin/env bash
# Derived facts enter main through a generated PR and the normal merge gates.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != bitbaum/fleet || "${GITHUB_REF:-}" != refs/heads/main ]]; then
  echo 'Registry proposal runs only in the disposable Fleet main Actions checkout.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Refusing to mix generated facts with existing tracked changes.' >&2
  exit 1
fi
: "${FLEET_DISPATCH_TOKEN:?FLEET_PAT is required for the catalogue dispatch}"
: "${GITHUB_OUTPUT:?Workflow output path is required}"
node scripts/ci/shared-registry-audit.mjs --emit registers/packages.json >/dev/null
diff_status=0
git diff --quiet -- registers/packages.json || diff_status=$?
if [[ "$diff_status" -gt 1 ]]; then
  echo "Registry diff failed; no proposal or notification." >&2
  exit "$diff_status"
fi
if [[ "$diff_status" -eq 0 ]]; then
  echo 'changed=false' >> "$GITHUB_OUTPUT"
  registry_sha="$(git rev-parse HEAD)"
  payload="$(jq -n --arg sha "$registry_sha" '{event_type:"package-registry-updated",client_payload:{packages_sha:$sha}}')"
  # Recover missed notifications, but never announce an unmerged proposal.
  GH_TOKEN="$FLEET_DISPATCH_TOKEN" gh api --method POST repos/bitbaum/bitbaum/dispatches --input - <<< "$payload"
else
  echo 'changed=true' >> "$GITHUB_OUTPUT"
  echo 'Changed registry awaits its generated PR and normal merge checks.'
fi
