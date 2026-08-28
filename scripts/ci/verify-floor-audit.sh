#!/usr/bin/env bash
# Fleet audit: does every repo's `verify` actually meet the golden CI floor?
#
# templates/ci/README.md defines "verified" as ONE script, identical in every
# repo:  verify = lint && typecheck && test.  That contract was written down
# and never enforced, so it drifted: repos ship a `verify` that silently omits
# a gate, and "verify is green" quietly means something different in each one.
# Every other guarantee in the fleet (the merge train, auto-merge, "green
# locally ⇒ green CI") is built on top of that sentence being true.
#
# This is deliberately ONE script that reads every repo remotely, NOT a check
# copied into each repo. The auto-merge sweep was copied into 17 repos and now
# has at least 5 live variants; a fix landed in one reaches none of the others.
# Central auditor = no drift by construction.
#
# SCOPE — what this does NOT prove. It audits the CONTRACT (does `verify` run
# all three gates), not whether each gate is EFFECTIVE. A repo whose `lint`
# script exists but silently does nothing passes here. sbb-lost-found is the
# live example: `next lint` prompts interactively because the repo has a flat
# config Next 14 cannot read, so lint has never actually run — and this audit
# would have called it satisfied had verify referenced it. Contract first;
# effectiveness is a separate check.
#
# ONE effectiveness hole is checked, because the fleet has already fallen down
# it: a CI step that RUNS a floor gate and then throws the result away with
# `continue-on-error: true`. evig's unit-test job carried that flag from the
# day it was added ("non-blocking while the suite matures"); the suite matured
# to 7,769 tests, the 2026-07-28 token sweep broke 25 assertions, and every PR
# for three weeks reported the job green. A discarded gate is worse than an
# absent one — it is an absent gate that produces a ✓. The check is narrow on
# purpose: only steps running lint/typecheck/test/verify count, so a
# best-effort step with a real fallback (orangecat's cd.yml artifact download)
# is correctly ignored.
#
# Usage:
#   scripts/ci/verify-floor-audit.sh              # audit, exit 1 on violations
#   scripts/ci/verify-floor-audit.sh --warn-only  # report, always exit 0
#
# Env:
#   GH_OWNER   GitHub owner to enumerate (default: bitbaum)
#   GH_LIMIT   max repos to inspect (default: 100)

set -uo pipefail   # NOT -e: nearly every step below asks a QUESTION about a
                   # remote repo, and a 404 is an answer, not a crash.

OWNER="${GH_OWNER:-bitbaum}"
LIMIT="${GH_LIMIT:-100}"
WARN_ONLY=0
[ "${1:-}" = "--warn-only" ] && WARN_ONLY=1

# --- Fetching is not knowing. -----------------------------------------------
#
# Every remote read here used to be `gh api ... 2>/dev/null`, and the empty
# output that a failure produces was then read as a FACT — "no package.json",
# "no workflows". A transient 403/5xx is not a fact. Measured 2026-08-16, one
# sweep produced FOUR wrong verdicts from that conflation:
#
#   vitareba, aoz-housing  — live JS apps, reported as "not a JS repo" and
#                            dropped from the floor entirely
#   ai-forms, fleetcrown   — reported "CI never runs verify" while line 19 and
#                            line 52 of their ci.yml do exactly that
#
# The tell was arithmetic: two runs an hour apart inspected 24 and 22 repos
# with no repo created or deleted between them. A check whose output moves
# while the thing it measures holds still is not measuring it.
#
# So the failure mode is now a THIRD state, never silence:
#   0 = fetched   2 = genuinely absent (404)   1 = could not look
#
# This is the same discipline the OPAQUE column already applies to unreadable
# verify scripts, applied to the transport instead of the content.
#
# `gh_get` itself lives in verify-predicates.sh so it can be tested against a
# stubbed `gh` — the bug it fixes was invisible precisely because nothing could
# exercise the failure path without a real outage.
trap 'rm -f "$GH_ERR"' EXIT

# Declared before any branch that could skip the assignment — under `set -u` a
# later reference would otherwise kill the whole run instead of one repo.
ok_list=""
weak_list=""
missing_list=""
skipped_list=""
unreadable_list=""
discarded_list=""
opaque_list=""
forks_list=""
uncalled_list=""
decomposed_list=""
softened_list=""
total=0

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 2; }

# The WIRING rules — does CI actually CALL verify, and unsoftened — live in
# their own file so they can be tested against fixtures without reaching
# GitHub. See the header there for why the content audit alone could not catch
# botsmann: a repo can satisfy every rule about what `verify` CONTAINS while
# nothing on the branch ever runs it.
# shellcheck source=scripts/ci/verify-predicates.sh
. "$(dirname "$0")/verify-predicates.sh"

# Report every step that both runs a floor gate and discards its result.
#
# Scoped to STEP blocks (a list item, `^\s*- `), not whole jobs: a step is the
# unit `continue-on-error` attaches to in the common case, and correlating a
# job-level flag with the gate it silences needs a real YAML parser. That is a
# known blind spot, stated rather than papered over — a job-level flag on a
# gate job would be missed here.
#
# A `run: |` block puts the command on LATER lines than the `run:` key, so any
# line inside the block is tested, not just the key line.
scan_discarded_gates() {
  awk -v wf="$1" '
    function flush() {
      if (has_gate && has_coe) printf "%s (%s)\n", wf, gate
      has_gate = 0; has_coe = 0; gate = ""
    }
    /^[[:space:]]*-[[:space:]]/ { flush() }
    {
      if ($0 ~ /(npm|pnpm|yarn|bun)([[:space:]]+run)?[[:space:]]+(test|lint|typecheck|type-check|verify)([[:space:]]|$)/ ||
          $0 ~ /(eslint|vitest|jest|mocha|playwright test|tsc[[:space:]]+--noEmit|vue-tsc|svelte-check)/) {
        has_gate = 1
        if (gate == "") { gate = $0; sub(/^[[:space:]]*(-[[:space:]]*)?(run:[[:space:]]*)?/, "", gate) }
      }
      if ($0 ~ /continue-on-error:[[:space:]]*true/) has_coe = 1
    }
    END { flush() }
  '
}

echo "verify-floor audit — owner: $OWNER"
echo "floor: verify must run lint AND typecheck AND test"
echo

repos=$(gh repo list "$OWNER" --limit "$LIMIT" --no-archived \
          --json name,defaultBranchRef,isFork \
          --jq '.[] | "\(.name)\t\(.defaultBranchRef.name // "")\t\(.isFork)"' 2>/dev/null)

if [ -z "$repos" ]; then
  echo "could not list repos for $OWNER" >&2
  exit 2
fi

while IFS=$'\t' read -r name branch is_fork; do
  [ -n "$name" ] || continue
  # A repo with no default branch ref is empty — nothing to audit, say so.
  if [ -z "$branch" ]; then
    skipped_list="${skipped_list}  $name (empty repo)\n"
    continue
  fi

  # A fork's build conventions belong to UPSTREAM. openclaw is a fork of
  # openclaw/openclaw: it verifies through its own harness (verify.mjs ->
  # `pnpm check` -> explicit tsgo typecheck + lint stages, then `pnpm test`)
  # and its CI runs that harness on a remote testbox rather than calling
  # `pnpm verify`. Measured against this fleet's floor it produced two findings,
  # BOTH artefacts of the measurement: "no typecheck" (it uses tsgo) and "CI
  # never runs verify" (CI runs the gates, not the alias). Adding a fleet-shaped
  # `verify` there would also conflict on every upstream sync. Listed, never
  # counted — a silently unaudited repo is the thing this script exists to
  # prevent, so forks are named rather than dropped.
  if [ "$is_fork" = true ]; then
    forks_list="${forks_list}  $name (fork — upstream owns its build + CI conventions)\n"
    continue
  fi

  # Resolve package.json ON THE REPO'S OWN DEFAULT BRANCH. Asking for ?ref=main
  # on a master repo 404s, which means "wrong ref", not "no package.json" —
  # that mistake previously produced a confidently wrong fleet survey.
  pkg_raw=$(gh_get "repos/$OWNER/$name/contents/package.json?ref=$branch")
  case $? in
    0) pkg=$(printf '%s' "$pkg_raw" | jq -r '.content // ""' 2>/dev/null \
               | tr -d '\n' | base64 -d 2>/dev/null) ;;
    2) skipped_list="${skipped_list}  $name (no package.json on $branch)\n"
       continue ;;
    *) unreadable_list="${unreadable_list}  $name — could not read package.json on $branch after 3 tries (API error, NOT absence)\n"
       continue ;;
  esac

  if [ -z "$pkg" ]; then
    unreadable_list="${unreadable_list}  $name — package.json on $branch fetched but decoded empty\n"
    continue
  fi

  total=$((total + 1))

  scripts=$(printf '%s' "$pkg" | jq -r '.scripts // {}' 2>/dev/null)
  if [ -z "$scripts" ] || [ "$scripts" = "null" ]; then
    unreadable_list="${unreadable_list}  $name (package.json did not parse)\n"
    continue
  fi

  verify=$(printf '%s' "$scripts" | jq -r '.verify // ""')

  gaps=""          # gates the repo COULD run but verify does not
  absent=""        # gates the repo has no script for at all
  opaque_gates=""  # gates we cannot see EITHER WAY, because verify delegates
                   # to a script file this audit does not execute or parse
  sub_unreadable=""  # sub-manifests the API would not hand over — a transport
                     # failure, which must not be read as "the gate isn't there"

  # Expand `npm run X` / `pnpm X` inside verify two levels deep, so a gate
  # counts whether it is reached via a named script or run directly. Matching
  # only script NAMES would flag fleetcrown (which calls `tsc --noEmit`
  # inline) and orangecat (whose script is `type-check`, hyphenated) as
  # having no typecheck — both false. A gate is satisfied by the TOOL that
  # runs, not by the name someone gave it.
  expand_once() {
    # Each `local` on its own line: under `set -u`, `local a="$1" b="$a"`
    # reads $a before the same statement assigns it, so the function aborts
    # and silently returns empty — which reads as "no gate found" and marks
    # every healthy repo as failing.
    local cmd="$1"
    local out="$cmd"
    local ref
    local body
    for ref in $(printf '%s' "$cmd" | grep -oE '(npm|pnpm|yarn)( run)? [a-zA-Z0-9:_-]+' \
                   | awk '{print $NF}' | sort -u); do
      body=$(printf '%s' "$scripts" | jq -r --arg k "$ref" '.[$k] // ""')
      [ -n "$body" ] && out="$out ; $body"
    done
    printf '%s' "$out"
  }
  expanded=$(expand_once "$verify")
  expanded=$(expand_once "$expanded")

  # Follow ONE level of sub-package delegation: `npm --prefix app run verify`
  # and `cd frontend && npm run lint` both leave this package.json entirely, so
  # without following them the audit sees an opaque command and concluded — for
  # printcraft — that verify skipped all three gates. It skipped none; the gates
  # live in app/package.json. Fetching the sub-manifest turns a confident wrong
  # answer into the real one.
  for pair in $(printf '%s' "$verify" \
                  | grep -oE -- '--prefix[[:space:]]+[A-Za-z0-9._/-]+[[:space:]]+(run[[:space:]]+)?[A-Za-z0-9:_-]+|cd[[:space:]]+[A-Za-z0-9._/-]+[[:space:]]*&&[[:space:]]*(npm|pnpm|yarn)([[:space:]]+run)?[[:space:]]+[A-Za-z0-9:_-]+' \
                  | tr -s ' ' '|' | sort -u); do
    sub_dir=$(printf '%s' "$pair" | awk -F'|' '{print $2}')
    sub_script=$(printf '%s' "$pair" | awk -F'|' '{print $NF}')
    [ -n "$sub_dir" ] && [ -n "$sub_script" ] || continue
    # A failed read here would make the sub-package's gate look ABSENT, i.e. a
    # "needs real work" verdict earned by a network blip. Retry, then record
    # that we could not look rather than letting silence mean absence.
    sub_raw=$(gh_get "repos/$OWNER/$name/contents/$sub_dir/package.json?ref=$branch")
    case $? in
      0) sub_pkg=$(printf '%s' "$sub_raw" | jq -r '.content // ""' 2>/dev/null \
                     | tr -d '\n' | base64 -d 2>/dev/null) ;;
      2) continue ;;                                   # genuinely no sub-manifest
      *) sub_unreadable="$sub_unreadable $sub_dir/package.json"; continue ;;
    esac
    [ -n "$sub_pkg" ] || continue
    sub_scripts=$(printf '%s' "$sub_pkg" | jq -r '.scripts // {}' 2>/dev/null)
    [ -n "$sub_scripts" ] && [ "$sub_scripts" != null ] || continue
    sub_body=$(printf '%s' "$sub_scripts" | jq -r --arg k "$sub_script" '.[$k] // ""')
    [ -n "$sub_body" ] || continue
    expanded="$expanded ; $sub_body"
    # One more hop inside the sub-package, so `verify -> lint` resolves to the
    # tool it actually runs.
    for ref in $(printf '%s' "$sub_body" | grep -oE '(npm|pnpm|yarn)( run)? [a-zA-Z0-9:_-]+' \
                   | awk '{print $NF}' | sort -u); do
      expanded="$expanded ; $(printf '%s' "$sub_scripts" | jq -r --arg k "$ref" '.[$k] // ""')"
    done
    all_bodies="$all_bodies
$(printf '%s' "$sub_scripts" | jq -r 'to_entries[] | "\(.key) \(.value)"')"
  done

  # Count test FILES on the branch, because "the repo has a `test` script" and
  # "the repo has tests" are different claims. sbb-lost-found declared
  # `test: jest` in four services with ZERO test files anywhere in the repo:
  # the script could only ever fail, which is why it was never wired into
  # verify. That is the third form of the same class as `continue-on-error` and
  # e2e-only — a gate that cannot pass, cannot fail, or cannot see anything.
  #
  # The pattern is deliberately GENEROUS: a false "no tests" would be exactly
  # the confident-absence bug this script just stopped committing. A truncated
  # tree is reported as unknown rather than zero, for the same reason.
  test_files=unknown
  # Already fails SAFE (unknown, never zero), but route it through the retrying
  # fetch anyway — an unknown here silently disables the no-test-files rule.
  tree=$(gh_get "repos/$OWNER/$name/git/trees/$branch?recursive=1") || tree=""
  if [ -n "$tree" ]; then
    if [ "$(printf '%s' "$tree" | jq -r '.truncated // false')" = true ]; then
      test_files=unknown          # too big to enumerate; do not guess
    else
      test_files=$(printf '%s' "$tree" | jq '[.tree[]? | select(.type == "blob")
        | select(.path | test("(^|/)(__tests__|__test__|tests?|specs?|e2e|cypress)/";"i")
                      or test("\\.(test|spec)\\.[cm]?[jt]sx?$";"i")
                      or test("_test\\.[cm]?[jt]sx?$";"i"))] | length' 2>/dev/null)
      [ -n "$test_files" ] || test_files=unknown
    fi
  fi

  # Does verify hand off to a SCRIPT FILE this audit cannot read? openclaw's
  # verify is `node scripts/verify.mjs`, which runs `pnpm check` then `pnpm
  # test`, and check.mjs has explicit typecheck (tsgo) and lint stages — a
  # superset of the floor. Reading arbitrary JS to prove that is not tractable
  # here, so the honest output is "cannot tell", NOT "gate missing". Absence of
  # evidence was being reported as evidence of absence.
  verify_is_opaque=no
  if printf '%s' "$expanded" \
       | grep -qE '(^|[^a-z])(node|bun|ts-node|tsx|bash|sh|python3?|make)[[:space:]]+[A-Za-z0-9._/-]+\.(mjs|cjs|js|ts|sh|py)'; then
    verify_is_opaque=yes
  fi

  # The repo's own `test` script, expanded — used to tell a hermetic unit suite
  # from an e2e runner wearing the same script name.
  test_body=$(printf '%s' "$scripts" | jq -r '.test // ""')
  test_body=$(expand_once "$test_body")

  # Same expansion over ALL scripts, to answer the different question of
  # whether the repo owns such a gate anywhere.
  all_bodies=$(printf '%s' "$scripts" | jq -r 'to_entries[] | "\(.key) \(.value)"')

  gate_re_lint='eslint|biome (lint|check)|next lint|oxlint|standard'
  # `tsgo` is the TypeScript-Go compiler; openclaw typechecks with it exclusively
  # (tsgo:core / tsgo:prod / tsgo:test) and was reported as having no typecheck
  # at all. A gate is satisfied by the TOOL that runs — including tools this
  # list learned about late.
  gate_re_type='tsc |tsc$|tsgo|vue-tsc|type-?check|svelte-check|astro check'
  gate_re_test='vitest|jest|playwright|node --test|mocha|ava |bun test|\btest\b'

  for gate in lint typecheck test; do
    case "$gate" in
      lint)      re="$gate_re_lint" ;;
      typecheck) re="$gate_re_type" ;;
      test)      re="$gate_re_test" ;;
    esac

    # A gate is satisfied two ways, and both are needed:
    #  1. verify CALLS a script named for it (`npm run lint`, `pnpm test`,
    #     `type-check`). Then the repo asserts the gate, and we take its word —
    #     which is what lets `turbo lint` and `cd frontend && npm run lint`
    #     count without this script having to see through them.
    #  2. verify runs the TOOL inline with no named script — fleetcrown calls
    #     `tsc --noEmit` straight from verify.
    # A test RUNNER with nothing to discover is empty in fact, however it reads
    # on paper — sbb-lost-found had `test: jest` in four packages and not one
    # test file in the repo, so the script could only ever fail and was
    # therefore never wired into verify.
    #
    # Scoped to file-DISCOVERING runners on purpose. A bespoke script carries
    # its own assertions and needs no test files to be real: ivy-portal's
    # `test` is `node scripts/smoke.mjs`, which boots the actual server,
    # asserts a 200 and exits with the true code. Flagging that would be
    # moralising about its shape rather than measuring whether it defends
    # anything — and this script has already had to unlearn accusing repos of
    # things it could not demonstrate.
    if [ "$gate" = test ] && [ "$test_files" = 0 ] && \
       printf '%s' "$test_body" \
         | grep -qE '(^|[^a-z-])(jest|vitest|mocha|ava|playwright|cypress|bun test|node[[:space:]]+--test)([^a-z-]|$)'; then
      absent="$absent test(runner-no-files)"
      continue
    fi

    # Checked against the whole REACHABLE call graph, not just verify's own
    # text, so a gate named inside a sub-package (printcraft: app/package.json)
    # counts the same as one named directly.
    if printf '%s' "$expanded" | grep -qE "(^|[^a-z:_-])(${gate}|type-check)([^a-z:_-]|$)"; then
      continue
    fi
    if printf '%s' "$expanded" | grep -qE "$re"; then
      continue
    fi

    # Verify disappears into a script file. We cannot see the gate, and we
    # cannot see its absence either — so say so instead of guessing.
    if [ "$verify_is_opaque" = yes ]; then
      opaque_gates="$opaque_gates $gate"
      continue
    fi

    # Not reached by verify. Does the repo own the gate anywhere?
    named=$(printf '%s' "$scripts" | jq -r --arg g "$gate" \
              'if (.[$g] // "") != "" or ($g == "typecheck" and (."type-check" // "") != "")
               then "yes" else "no" end')

    if [ "$named" = yes ] || printf '%s' "$all_bodies" | grep -qE "$re"; then
      # "The repo has a `test` script" is NOT the same as "the repo has a
      # hermetic test suite". datacat's is `npx playwright test`: it needs
      # browsers and a running server, so promoting it into `verify` would
      # break the floor's hermeticity rule AND the "green verify locally ⇒
      # green CI" promise it exists to keep. Per templates/ci/README.md e2e is
      # an UPGRADE rung, not the floor — so this is real work (write a unit
      # suite), not a one-line verify edit.
      if [ "$gate" = test ] && \
         printf '%s' "$test_body" | grep -qE 'playwright|cypress|puppeteer|webdriver' && \
         ! printf '%s' "$test_body" | grep -qE 'vitest|jest|mocha|node --test|bun test|ava '; then
        absent="$absent test(e2e-only)"
      else
        gaps="$gaps $gate"          # repo owns it, verify just skips it
      fi
    else
      absent="$absent $gate"        # nothing in the repo runs this gate
    fi
  done

  # Effectiveness probe: a gate CI runs and then ignores. Costs one listing
  # plus one fetch per workflow file, which is why it lives in a weekly cron
  # and not a per-push hook.
  ci_calls_verify=no
  ci_softened_in=""
  all_wf=""
  # Set the moment any workflow read fails. Every wiring verdict below is then
  # withheld: an unread workflow is the one that might have contained the call
  # we are about to report missing. This is what accused ai-forms of never
  # running `verify` when its ci.yml line 19 is `npm run verify`.
  wiring_unknown=""

  wf_index=$(gh_get "repos/$OWNER/$name/contents/.github/workflows?ref=$branch")
  case $? in
    0) wf_names=$(printf '%s' "$wf_index" \
                    | jq -r '.[]? | select(.name | test("\\.ya?ml$")) | .name' 2>/dev/null) ;;
    2) wf_names="" ;;   # genuinely no workflows directory
    *) wf_names=""; wiring_unknown="could not list .github/workflows" ;;
  esac

  for wf in $wf_names; do
    wf_raw=$(gh_get "repos/$OWNER/$name/contents/.github/workflows/$wf?ref=$branch")
    case $? in
      0) wf_body=$(printf '%s' "$wf_raw" | jq -r '.content // ""' 2>/dev/null \
                     | tr -d '\n' | base64 -d 2>/dev/null) ;;
      *) wiring_unknown="could not read $wf"; continue ;;
    esac
    [ -n "$wf_body" ] || { wiring_unknown="$wf decoded empty"; continue; }
    hits=$(printf '%s\n' "$wf_body" | scan_discarded_gates "$wf")
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      discarded_list="${discarded_list}  $name — $hit\n"
    done <<< "$hits"

    # Same fetched body, two more questions — free, since the bytes are here.
    if ci_invokes_verify "$wf_body"; then
      ci_calls_verify=yes
      ci_verify_softened "$wf_body" && ci_softened_in="$wf"
    fi
    all_wf="${all_wf}
${wf_body}"
  done

  # Orthogonal to the content audit above: a repo can be AT FLOOR on what
  # `verify` contains and still have nothing on the branch that runs it.
  #
  # Calling `npm run verify` is the direct way to satisfy this. It is not the
  # only way: a repo may run each constituent script by name, unsoftened, to
  # fan the gates into parallel jobs. That satisfies the actual contract — every
  # gate runs and every one can still fail — so it is reported separately rather
  # than counted as a violation. Demanding the literal string was asking
  # aoz-housing to serialize the slowest pipeline in the fleet to please a
  # regex.
  if [ -n "$verify" ] && [ "$ci_calls_verify" = no ]; then
    if [ -n "$wiring_unknown" ]; then
      # Withheld, not decided. The unread file is exactly the one that could
      # have contained the call, so "not found" here would be a claim about a
      # place we never looked.
      unreadable_list="${unreadable_list}  $name — wiring verdict withheld: $wiring_unknown\n"
    elif ci_runs_verify_gates "$all_wf" "$verify"; then
      decomposed_list="${decomposed_list}  $name — CI runs each gate by name instead of \`verify\`\n"
    else
      uncalled_list="${uncalled_list}  $name — CI never runs \`verify\`\n"
    fi
  fi
  if [ -n "$ci_softened_in" ]; then
    softened_list="${softened_list}  $name — $ci_softened_in runs verify with --if-present\n"
  fi
  if [ -n "$verify" ] && verify_softens_itself "$verify"; then
    softened_list="${softened_list}  $name — \`verify\` softens itself: $verify\n"
  fi

  if [ -n "$sub_unreadable" ] && [ -n "$absent" ]; then
    # The gate looks missing, but a sub-manifest that could have defined it is
    # exactly what we failed to fetch. Withheld rather than charged.
    opaque_list="${opaque_list}  $name — gate verdict withheld; could not read:$sub_unreadable\n"
  elif [ -z "$verify" ]; then
    missing_list="${missing_list}  $name — no \`verify\` script at all\n"
  elif [ -n "$absent" ]; then
    # Not fixable by editing verify: the repo has no such script. Adding a
    # no-op to satisfy the floor would be theatre, so this is reported as work.
    missing_list="${missing_list}  $name — no hermetic script for:$absent${gaps:+ (also missing from verify:$gaps)}\n"
  elif [ -n "$gaps" ]; then
    weak_list="${weak_list}  $name — has the script but verify skips:$gaps\n"
  elif [ -n "$opaque_gates" ]; then
    # Reported, never counted. "I could not see it" is a different statement
    # from "it is not there", and collapsing the two is how this audit told the
    # fleet that openclaw — which typechecks with tsgo and lints in an explicit
    # check stage — had no typecheck at all.
    opaque_list="${opaque_list}  $name — verify delegates to a script; could not verify:$opaque_gates\n"
  else
    ok_list="${ok_list}  $name\n"
  fi
done <<< "$repos"

printf '✓ AT FLOOR (%s)\n' "$(printf '%b' "$ok_list" | grep -c . || true)"
printf '%b' "${ok_list:-  (none)\n}"

echo
printf '▲ FIXABLE — verify omits a gate the repo already has\n'
printf '%b' "${weak_list:-  (none)\n}"

echo
printf '✗ NEEDS REAL WORK — no hermetic script exists for a required gate\n'
printf '  (test(e2e-only)      = has a `test` script, but it drives a browser —\n'
printf '                         an upgrade rung, not the floor.\n'
printf '   test(runner-no-files) = `test` runs a file-discovering runner (jest,\n'
printf '                         vitest, …) and the branch has NO test files, so\n'
printf '                         it can only ever fail. A bespoke script that\n'
printf '                         carries its own assertions is NOT this.)\n'
printf '%b' "${missing_list:-  (none)\n}"

echo
printf '⊘ DISCARDED — CI runs a floor gate and throws the result away\n'
printf '%b' "${discarded_list:-  (none)\n}"

echo
printf '? OPAQUE — verify hands off to a script file; not a violation, unproven\n'
printf '  ("could not read it" is not "it is not there". openclaw is why this\n'
printf '   column exists — its verify.mjs runs `pnpm check` then `pnpm test`,\n'
printf '   with explicit tsgo-typecheck and lint stages, i.e. ABOVE the floor,\n'
printf '   and was reported as having none of them. It is now excluded as a\n'
printf '   fork, but the blind spot it exposed is real for any repo.)\n'
printf '%b' "${opaque_list:-  (none)\n}"

echo
printf '⊗ UNCALLED — the repo defines `verify`, but no workflow runs it\n'
printf '  (AT FLOOR above judges what verify CONTAINS; this judges whether\n'
printf '   anything on the branch actually runs it. A repo can pass one and\n'
printf '   fail the other — botsmann did.)\n'
printf '%b' "${uncalled_list:-  (none)\n}"

echo
printf '≡ DECOMPOSED — CI runs every gate by name, unsoftened, but never the\n'
printf '  word `verify`. NOT a violation: the contract is that each gate runs\n'
printf '  and can still fail, and it does. aoz-housing splits lint+typecheck,\n'
printf '  unit tests and build into parallel jobs on purpose — collapsing that\n'
printf '  into one verify step would serialize the fleet-slowest pipeline.\n'
printf '  Residual risk, stated: a gate ADDED to verify later will not reach\n'
printf '  CI by itself. That is exactly what this check keeps watching for.\n'
printf '%b' "${decomposed_list:-  (none)\n}"

echo
printf '⊙ SOFTENED — verify is invoked, or written, so that it cannot fail\n'
printf '%b' "${softened_list:-  (none)\n}"


if [ -n "$skipped_list" ]; then
  echo
  echo "· skipped (not a JS repo / empty)"
  printf '%b' "$skipped_list"
fi

if [ -n "$forks_list" ]; then
  echo
  echo "· forks (not audited — the floor is this fleet's convention, not upstream's)"
  printf '%b' "$forks_list"
fi

if [ -n "$unreadable_list" ]; then
  echo
  echo "· unreadable"
  printf '%b' "$unreadable_list"
fi

echo
echo "inspected $total JS repo(s)"
echo "note: this checks that verify RUNS each gate, not that each gate works —"
echo "      with one exception, the discarded-gate check above."

violations=$(( $(printf '%b' "$weak_list" | grep -c . || true) + \
               $(printf '%b' "$missing_list" | grep -c . || true) + \
               $(printf '%b' "$discarded_list" | grep -c . || true) + \
               $(printf '%b' "$uncalled_list" | grep -c . || true) + \
               $(printf '%b' "$softened_list" | grep -c . || true) ))

if [ "$violations" -gt 0 ] && [ "$WARN_ONLY" -eq 0 ]; then
  echo "verify-floor: $violations repo(s) below the floor" >&2
  exit 1
fi

echo "verify-floor: $violations repo(s) below the floor"
