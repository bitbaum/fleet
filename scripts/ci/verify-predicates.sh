#!/usr/bin/env bash
#
# Predicates for the WIRING half of the verify contract.
#
# verify-floor-audit.sh already answers "does `verify` run all three gates?" —
# a question about the CONTENT of the script. These answer the other half, which
# that audit could not see and which let a real violation sit undetected:
#
#     botsmann's `verify` was perfect — format:check + lint + test + build — so
#     the content audit correctly reported it AT FLOOR. Its CI never called it.
#     CI hand-copied the same four steps and put `--if-present` on each, so a
#     renamed script would have become a silent pass. A repo can satisfy every
#     rule about what `verify` CONTAINS while nothing on the branch runs it.
#
# Kept in their own file, sourced by the audit, so the rules can be tested
# against fixtures without reaching GitHub. The audit itself is remote-only by
# design (it reads every repo's own default branch), and a rule that can only be
# exercised by a live API call is a rule nobody re-tests after changing it.

# --- Transport: a failed fetch is not a finding -----------------------------
#
# The audit's remote reads were all `gh api ... 2>/dev/null`, and the empty
# string a failure yields was then read as a FACT. On 2026-08-16 that produced
# four wrong verdicts in a single sweep: vitareba and aoz-housing (live JS apps)
# reported as "not a JS repo", ai-forms and fleetcrown reported as never running
# `verify` when their ci.yml does so on lines 19 and 52. The tell was
# arithmetic — two runs an hour apart inspected 24 and 22 repos with no repo
# created or destroyed between them.
#
# Three states, never silence:
#   0 = fetched          stdout carries the body
#   2 = genuinely absent the API said 404, which is an ANSWER
#   1 = could not look   transport failed after retries; caller must WITHHOLD
#
# It lives here rather than in the audit so the failure path can be exercised
# against a stubbed `gh`. That is the whole lesson: this bug survived because
# nothing could reach its failure path without a real outage.
GH_ERR="${GH_ERR:-$(mktemp)}"

gh_get() {
  local path="$1" attempt=1 out
  while [ "$attempt" -le "${GH_GET_TRIES:-3}" ]; do
    if out=$(gh api "$path" 2>"$GH_ERR"); then
      printf '%s' "$out"
      return 0
    fi
    # A 404 is an ANSWER — the resource is not there. Do not retry it, and do
    # not let it share an exit code with "the API refused to talk to us".
    if grep -qiE 'not found|HTTP 404' "$GH_ERR"; then
      return 2
    fi
    # An exhausted rate limit is also an answer — about the transport, not the
    # repo. No backoff measured in seconds outlives a window measured in
    # hours; retrying triples the burn exactly when calls are scarcest (a
    # 29-repo sweep spent 87 calls rediscovering the same fact, 2026-08-20).
    if grep -qi 'rate limit' "$GH_ERR"; then
      return 1
    fi
    sleep "${GH_GET_BACKOFF:-$((attempt * 2))}"
    attempt=$((attempt + 1))
  done
  return 1
}

# Does any workflow actually invoke the verify SSOT?
#
# Accepts every package manager AND the implicit-run spellings (`pnpm verify`,
# `yarn verify`) which are idiomatic — an earlier version demanded the literal
# `run` and reported a conforming repo as broken, which is how a checker earns
# being ignored. `\b` stops it matching a longer name like `verify-deploy`.
ci_invokes_verify() {
  printf '%s\n' "$1" | grep -qE '(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+verify([[:space:]]|$)'
}

# Is that invocation softened with --if-present?
#
# `--if-present` turns a missing script into a PASS. On the verify step that is
# the gate-that-cannot-go-red shape: delete or rename `verify` and CI stays
# green while nothing is checked. Only lines that actually invoke verify are
# tested, so `--if-present` on some unrelated optional step is not flagged.
ci_verify_softened() {
  printf '%s\n' "$1" \
    | grep -E '(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+verify([[:space:]]|$)' \
    | grep -q -- '--if-present'
}

# Does `verify` disarm itself from the inside?
#
# This one defeats every other rule: CI can faithfully run a gate that has been
# told never to fail. sbb-lost-found shipped
# `npm run typecheck --workspaces --if-present`, which silently passes any
# workspace without a typecheck script.
verify_softens_itself() {
  case "$1" in
    *"|| true"*|*"--if-present"*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Calling verify is one way to satisfy the contract. It is not the only one.
#
# `ci_invokes_verify` matches a STRING (`npm run verify`). The property anyone
# actually cares about is different and weaker:
#
#     every gate `verify` composes also runs in CI, unsoftened.
#
# Calling `npm run verify` satisfies that. So does calling each constituent
# script by name — which aoz-housing does deliberately, to fan lint+typecheck,
# unit tests and build into parallel jobs with their own coverage artifact.
# Collapsing that into one `npm run verify` step would serialize the slowest
# pipeline in the fleet and delete the artifact, i.e. the string-match rule was
# asking a conforming repo to get worse to satisfy a proxy.
#
# botsmann is still caught, because its hand-copy put `--if-present` on every
# step: a renamed script became a silent pass. That is the difference these
# predicates encode — hand-copying is fine, hand-copying with a soft landing is
# not.

# Which named scripts does `verify` compose?
#
# Only npm-script invocations count. A verify that shells out directly
# (`eslint . && tsc --noEmit`) yields nothing, and the caller must then fall
# back to demanding a literal verify call — we cannot prove a bare binary in a
# workflow is the same gate.
verify_gate_scripts() {
  printf '%s\n' "$1" \
    | grep -oE '(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+[A-Za-z0-9:._-]+' \
    | sed -E 's/^(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+//' \
    | grep -vE '^(run|ci|install|i|add|exec|x|dlx|verify)$' \
    | sort -u
}

# Does CI run this one script, in a way that can still fail?
#
# "Unsoftened" is the whole point: among the lines that invoke the script, at
# least one must lack `--if-present`. A repo may legitimately soften an optional
# step elsewhere; it may not soften every invocation of a floor gate.
ci_runs_script() {
  local escaped
  escaped=$(printf '%s' "$2" | sed 's/[.[\*^$]/\\&/g')
  printf '%s\n' "$1" \
    | grep -E "(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+${escaped}([[:space:]]|\$)" \
    | grep -qv -- '--if-present'
}

# Does CI run every gate that `verify` composes?
#
# Returns false when `verify` cannot be decomposed, so an undecidable case is
# reported as unproven rather than waved through — the same "could not look" vs
# "is not there" split the OPAQUE column exists for.
ci_runs_verify_gates() {
  local gates gate
  gates=$(verify_gate_scripts "$2")
  [ -n "$gates" ] || return 1
  while IFS= read -r gate; do
    [ -n "$gate" ] || continue
    ci_runs_script "$1" "$gate" || return 1
  done <<EOF
$gates
EOF
  return 0
}
