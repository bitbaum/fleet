#!/usr/bin/env bash
# Prove audit-health.sh both ways: it BITES on each defect it claims to catch,
# and it stays SILENT on the conforming shapes that look like those defects.
#
# The second half is the point. templates/ci/README.md records two false
# positives this repo's audits shipped — ivy-portal (a bespoke test script read
# as "no test files") and aoz-begleitung (a deliberately decomposed CI read as
# "never runs verify") — and both had the same cause: the rule encoded the
# first example it was written from rather than the property that example
# illustrated. So every BITES case here is paired with a QUIET case that shares
# its surface shape and must not fire.
#
# `gh` is stubbed. The audit is remote-only by design, and a rule that can only
# be exercised by a live API call is a rule nobody re-tests after editing its
# regex.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT="$HERE/audit-health.sh"
pass=0; fail=0

ok()   { printf '  ✓ %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  ✗ %s\n' "$1"; fail=$((fail + 1)); }

# --- fixture scaffolding ------------------------------------------------------
# $1 = workflow filename, $2 = cron line (or empty), $3 = extra body
mkwf() {
  local dir="$1" name="$2" cron="$3" body="${4:-}"
  mkdir -p "$dir/.github/workflows"
  {
    echo "name: ${name%.yml}"
    echo "on:"
    [ -n "$cron" ] && { echo "  schedule:"; echo "    - cron: '$cron'"; }
    echo "  workflow_dispatch:"
    echo "jobs:"
    echo "  audit:"
    echo "    runs-on: ubuntu-latest"
    echo "    steps:"
    echo "      - run: echo hi"
    [ -n "$body" ] && echo "$body"
  } > "$dir/.github/workflows/$name"
}

# Builds a stub `gh` that answers from a per-case spec file.
#   WFLIST  — the workflows listing JSON
#   RUNS_<id> — the runs JSON for workflow id
#   SECRETS — newline list of existing secret names
make_gh() {
  local dir="$1"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/gh" <<'STUB'
#!/usr/bin/env bash
spec="$GH_SPEC"
case "$1 $2" in
  "secret list")
    if [ -f "$spec/SECRETS" ]; then jq -R . < "$spec/SECRETS" | jq -s 'map(select(length>0))|.[]' -r; fi
    exit 0 ;;
esac
if [ "$1" = "api" ]; then
  path="$2"
  case "$path" in
    *"/actions/workflows") cat "$spec/WFLIST"; exit 0 ;;
    *"/actions/workflows/"*"/runs"*)
      id=$(sed -E 's|.*/workflows/([0-9]+)/runs.*|\1|' <<<"$path")
      if [ -f "$spec/RUNS_$id" ]; then cat "$spec/RUNS_$id"; exit 0; fi
      if [ -f "$spec/UNREADABLE_$id" ]; then echo "gh: Bad gateway (HTTP 502)" >&2; exit 1; fi
      echo '{"workflow_runs":[]}'; exit 0 ;;
    *"actions/secrets")
      if [ -f "$spec/ORGSECRETS" ]; then jq -R . < "$spec/ORGSECRETS" | jq -s 'map(select(length>0))|.[]' -r; fi
      exit 0 ;;
  esac
fi
exit 0
STUB
  chmod +x "$dir/bin/gh"
}

run_case() {
  local dir="$1"; shift
  ( cd "$dir" && PATH="$dir/bin:$PATH" GH_SPEC="$dir/spec" OWNER=acme REPO=widget \
      bash "$AUDIT" --check 2>&1 )
}

# A run row N days old with a given conclusion.
runrow() {
  local concl="$1" days="$2"
  local when
  when=$(date -u -d "-${days} days" +%Y-%m-%dT%H:%M:%SZ)
  if [ "$concl" = "null" ]; then
    echo "{\"workflow_runs\":[{\"conclusion\":null,\"created_at\":\"$when\"}]}"
  else
    echo "{\"workflow_runs\":[{\"conclusion\":\"$concl\",\"created_at\":\"$when\"}]}"
  fi
}

new_case() {
  local d; d=$(mktemp -d); mkdir -p "$d/spec"; make_gh "$d"
  printf '%s' "$d"
}

# =============================================================================
echo "audit-health — QUIET on a healthy fleet"
d=$(new_case)
mkwf "$d" healthy.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/healthy.yml","name":"Healthy","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 2 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "green, recent, no phantom → exit 0" || bad "healthy fleet flagged (exit $rc): $out"
grep -q "every fleet audit ran recently" <<<"$out" && ok "says so explicitly" || bad "no success line"

# =============================================================================
echo
echo "audit-health — BITES on a failed audit"
d=$(new_case)
mkwf "$d" red.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/red.yml","name":"Red","state":"active"}]}' > "$d/spec/WFLIST"
runrow failure 1 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "a red audit fails the check" || bad "red audit not caught (exit $rc)"
grep -q "nobody read it" <<<"$out" && ok "reported under RED" || bad "not reported as RED"

# =============================================================================
echo
echo "audit-health — BITES on a CANCELLED audit (it audited nothing)"
d=$(new_case)
mkwf "$d" canc.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/canc.yml","name":"Canc","state":"active"}]}' > "$d/spec/WFLIST"
runrow cancelled 1 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "cancelled is NOT success" || bad "cancelled treated as green — the hosted-supabase hole"

# =============================================================================
echo
echo "audit-health — STALE is derived from the workflow's OWN cron"
# weekly audit, green, 20 days old → stale (allowance is 17d)
d=$(new_case)
mkwf "$d" weekly.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/weekly.yml","name":"W","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 20 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "weekly audit silent for 20d → STALE" || bad "stale weekly not caught"
grep -q "stopped firing" <<<"$out" && ok "reported under STALE" || bad "not reported as STALE"

# the SAME age against a MONTHLY cadence must stay quiet — this is the pairing
d=$(new_case)
mkwf "$d" monthly.yml '17 6 3 * *'
echo '{"workflows":[{"id":1,"path":".github/workflows/monthly.yml","name":"M","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 20 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "same 20d gap on a MONTHLY cron stays quiet" || bad "monthly cadence flagged at 20d: $out"

# a daily audit quiet for 5 days IS stale
d=$(new_case)
mkwf "$d" daily.yml '17 6 * * *'
echo '{"workflows":[{"id":1,"path":".github/workflows/daily.yml","name":"D","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 5 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "daily audit silent for 5d → STALE" || bad "stale daily not caught"

# a dispatch-only workflow has no cadence to miss — must never be STALE
d=$(new_case)
mkwf "$d" ondemand.yml ''
echo '{"workflows":[{"id":1,"path":".github/workflows/ondemand.yml","name":"O","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 400 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "dispatch-only workflow is never STALE" || bad "dispatch-only flagged as stale: $out"

# =============================================================================
echo
echo "audit-health — BITES on a workflow GitHub REFUSED (listed by path, 0 runs)"
d=$(new_case)
mkwf "$d" refused.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/refused.yml","name":".github/workflows/refused.yml","state":"active"}]}' > "$d/spec/WFLIST"
echo '{"workflow_runs":[]}' > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "never-run workflow caught" || bad "never-run not caught"
grep -q "duplicate key" <<<"$out" && ok "names the duplicate-key cause" || bad "no duplicate-key hint"

# A workflow YOUNGER than its own cadence cannot have run yet. entity-drift.yml
# was added at 07:22 on a `41 6 * * *` cron — that day's tick had passed — and
# this rule charged it seven hours later for not doing the impossible.
# `git log --diff-filter=A` supplies the add date, so the fixture needs a repo.
d=$(new_case)
mkwf "$d" fresh.yml '41 6 * * *'
echo '{"workflows":[{"id":1,"path":".github/workflows/fresh.yml","name":"Fresh","state":"active"}]}' > "$d/spec/WFLIST"
echo '{"workflow_runs":[]}' > "$d/spec/RUNS_1"
( cd "$d" && git init -q . && git add .github >/dev/null 2>&1 \
  && git -c user.email=t@t -c user.name=t commit -qm "add fresh.yml" >/dev/null 2>&1 )
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "a workflow younger than its cadence is not charged" || bad "charged a workflow that could not have run yet: $out"
grep -q "too new to have run" <<<"$out" && ok "says why it was not counted" || bad "silently skipped instead of saying why"

# ...but the grace must not become a blanket excuse: an OLD workflow that has
# never run is still a finding.
d=$(new_case)
mkwf "$d" stalefresh.yml '41 6 * * *'
echo '{"workflows":[{"id":1,"path":".github/workflows/stalefresh.yml","name":"SF","state":"active"}]}' > "$d/spec/WFLIST"
echo '{"workflow_runs":[]}' > "$d/spec/RUNS_1"
( cd "$d" && git init -q . && git add .github >/dev/null 2>&1 \
  && GIT_AUTHOR_DATE="2020-01-01T00:00:00" GIT_COMMITTER_DATE="2020-01-01T00:00:00" \
     git -c user.email=t@t -c user.name=t commit -qm "old" >/dev/null 2>&1 )
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "an OLD workflow that never ran is still caught" || bad "grace swallowed a real never-run"

# and a REFUSED file gets no grace at any age — it is a defect, not a calendar
d=$(new_case)
mkwf "$d" refusedfresh.yml '41 6 * * *'
echo '{"workflows":[{"id":1,"path":".github/workflows/refusedfresh.yml","name":".github/workflows/refusedfresh.yml","state":"active"}]}' > "$d/spec/WFLIST"
echo '{"workflow_runs":[]}' > "$d/spec/RUNS_1"
( cd "$d" && git init -q . && git add .github >/dev/null 2>&1 \
  && git -c user.email=t@t -c user.name=t commit -qm "add refused" >/dev/null 2>&1 )
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "a REFUSED file is caught even when brand new" || bad "grace hid a refused workflow"

# =============================================================================
echo
echo "audit-health — PHANTOM SECRET"
d=$(new_case)
mkwf "$d" tok.yml '17 6 * * 1' "        env:
          GH_TOKEN: \${{ secrets.NOPE_TOKEN || secrets.GITHUB_TOKEN }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/tok.yml","name":"T","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
printf 'REAL_TOKEN\n' > "$d/spec/SECRETS"
out=$(run_case "$d"); rc=$?
[ $rc -eq 1 ] && ok "a referenced secret that does not exist is caught" || bad "phantom secret missed"
grep -q "NOPE_TOKEN" <<<"$out" && ok "names the phantom" || bad "phantom not named"
grep -q "GITHUB_TOKEN — which does not exist" <<<"$out" && bad "flagged the built-in GITHUB_TOKEN" || ok "built-in GITHUB_TOKEN not flagged"

# a secret that DOES exist must stay quiet
d=$(new_case)
mkwf "$d" tok2.yml '17 6 * * 1' "        env:
          GH_TOKEN: \${{ secrets.REAL_TOKEN }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/tok2.yml","name":"T2","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
printf 'REAL_TOKEN\n' > "$d/spec/SECRETS"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "an existing secret stays quiet" || bad "existing secret flagged: $out"

# an ORG secret counts as existing
d=$(new_case)
mkwf "$d" tok3.yml '17 6 * * 1' "        env:
          GH_TOKEN: \${{ secrets.ORG_WIDE }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/tok3.yml","name":"T3","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
printf 'ORG_WIDE\n' > "$d/spec/ORGSECRETS"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "an ORG-level secret counts as existing" || bad "org secret flagged: $out"

# THE FALSE POSITIVE THIS RULE WOULD OTHERWISE SHIP WITH:
# a reusable workflow's `secrets: token:` is a workflow_call INPUT, not a repo
# secret. auto-merge-sweep.yml is the live example.
d=$(new_case)
mkdir -p "$d/.github/workflows"
cat > "$d/.github/workflows/reusable.yml" <<'RW'
name: Reusable sweep
on:
  workflow_call:
    secrets:
      my_input_token:
        required: true
jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - run: echo x
        env:
          GH_TOKEN: ${{ secrets.my_input_token }}
RW
echo '{"workflows":[{"id":1,"path":".github/workflows/reusable.yml","name":"Reusable sweep","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "a workflow_call secret INPUT is not a phantom" || bad "false positive on a reusable workflow input: $out"

# An ALLOW-LISTED secret is absent on purpose (SWH_TOKEN only lifts a rate
# limit) and must stay quiet — while a name NOT on the list still bites, so the
# allow file cannot become a blanket exemption.
d=$(new_case)
mkwf "$d" opt.yml '17 6 * * 1' "        env:
          A: \${{ secrets.OPTIONAL_ONE }}
          B: \${{ secrets.NOT_LISTED }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/opt.yml","name":"O","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
# audit-health.sh reads the allow file next to itself, so point the case at a
# copy of the script with its own allow file.
mkdir -p "$d/bin2"
cp "$AUDIT" "$d/bin2/audit-health.sh"
printf '# reason\nOPTIONAL_ONE\n' > "$d/bin2/audit-health.allow"
out=$( cd "$d" && PATH="$d/bin:$PATH" GH_SPEC="$d/spec" OWNER=acme REPO=widget bash "$d/bin2/audit-health.sh" --check 2>&1 ); rc=$?
grep -q "OPTIONAL_ONE" <<<"$out" && bad "an allow-listed secret was still flagged" || ok "an allow-listed optional secret stays quiet"
grep -q "NOT_LISTED" <<<"$out" && ok "a name absent from the allow file still bites" || bad "allow file became a blanket exemption"
[ $rc -eq 1 ] && ok "still fails on the unlisted one" || bad "exit 0 despite an unlisted phantom"

# =============================================================================
echo
echo "audit-health — an unreadable run listing is WITHHELD, not charged"
d=$(new_case)
mkwf "$d" flaky.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/flaky.yml","name":"F","state":"active"}]}' > "$d/spec/WFLIST"
touch "$d/spec/UNREADABLE_1"
out=$(run_case "$d"); rc=$?
grep -q "problem(s) in the layer" <<<"$out" && bad "an outage was charged as a finding — the audit's own worst bug" \
  || ok "a 502 is not a finding (three-state read)"
grep -q "UNREADABLE" <<<"$out" && ok "reported honestly as unreadable" || bad "outage silently swallowed"
# ...and with NOTHING readable it must not pass either. Withheld is not a
# finding, but it is not a clean bill of health: a blind watchdog reporting
# green is the failure this script exists to end.
[ $rc -eq 2 ] && ok "every audit unreadable -> exit 2, neither finding nor pass" \
  || bad "a wholly blind run exited $rc (want 2)"
grep -q "read NOTHING" <<<"$out" && ok "says it read nothing" || bad "no refusal message"

# A PARTIAL outage is different: what was read is still worth reporting, but
# the sentence must cover only that. Observed 2026-09-18 claiming "every fleet
# audit ... went green" with two workflows under UNREADABLE three lines above.
d=$(new_case)
mkwf "$d" seen.yml '17 6 * * 1'
mkwf "$d" blind.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/seen.yml","name":"S","state":"active"},{"id":2,"path":".github/workflows/blind.yml","name":"B","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
touch "$d/spec/UNREADABLE_2"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "one readable and green -> still a pass" || bad "a partial outage failed the check (exit $rc)"
grep -q "every fleet audit" <<<"$out" && bad "claimed EVERY audit while one was unreadable" \
  || ok "does not say 'every' when one could not be read"
grep -q "1 audit(s) READ" <<<"$out" && ok "scopes the verdict to what it read" || bad "verdict not scoped: $out"
grep -q "says nothing about them" <<<"$out" && ok "names the gap out loud" || bad "gap not stated"

# THE BUG THIS SCRIPT SHIPPED AND EXISTS TO REPORT.
# Listing secrets needs a scope most tokens lack. Its first CI run could read
# neither listing, concluded the set of existing secrets was empty, and charged
# 21 workflows for secrets that all exist — FLEET_PAT and TELEGRAM_* included.
# A failed fetch reported as a finding, in the script written to report it.
d=$(new_case)
mkwf "$d" blind.yml '17 6 * * 1' "        env:
          GH_TOKEN: \${{ secrets.REALLY_EXISTS }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/blind.yml","name":"B","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
# No SECRETS/ORGSECRETS fixture and a stub that FAILS the listing → cannot look.
cat > "$d/bin/gh" <<'BLIND'
#!/usr/bin/env bash
spec="$GH_SPEC"
case "$1 $2" in
  "secret list") echo "gh: insufficient scope" >&2; exit 1 ;;
esac
if [ "$1" = "api" ]; then
  case "$2" in
    *"actions/secrets") echo "gh: HTTP 403" >&2; exit 1 ;;
    *"/actions/workflows") cat "$spec/WFLIST"; exit 0 ;;
    *"/actions/workflows/"*"/runs"*)
      id=$(sed -E 's|.*/workflows/([0-9]+)/runs.*|\1|' <<<"$2")
      [ -f "$spec/RUNS_$id" ] && { cat "$spec/RUNS_$id"; exit 0; }
      echo '{"workflow_runs":[]}'; exit 0 ;;
  esac
fi
exit 0
BLIND
chmod +x "$d/bin/gh"
out=$(run_case "$d"); rc=$?
grep -q "REALLY_EXISTS" <<<"$out" && bad "charged a secret while unable to list secrets — the 21-false-findings bug" || ok "an unreadable secret listing charges nothing"
grep -q "WITHHELD" <<<"$out" && ok "says the check was withheld" || bad "silently skipped instead of withholding out loud"
[ $rc -eq 0 ] && ok "does not fail the run on an outage" || bad "an outage failed the check (exit $rc)"

# SECRET_NAMES (from toJSON(secrets) in Actions) is authoritative when set, so
# the check BITES in CI instead of withholding forever. Same blind stub as
# above — the API listings fail — but the names arrive by env var.
d=$(new_case)
mkwf "$d" ctx.yml '17 6 * * 1' "        env:
          A: \${{ secrets.PROVIDED }}
          B: \${{ secrets.ABSENT_ONE }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/ctx.yml","name":"C","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
cat > "$d/bin/gh" <<'BLIND2'
#!/usr/bin/env bash
spec="$GH_SPEC"
case "$1 $2" in
  "secret list") echo "gh: insufficient scope" >&2; exit 1 ;;
esac
if [ "$1" = "api" ]; then
  case "$2" in
    *"actions/secrets") echo "gh: HTTP 403" >&2; exit 1 ;;
    *"/actions/workflows") cat "$spec/WFLIST"; exit 0 ;;
    *"/actions/workflows/"*"/runs"*)
      id=$(sed -E 's|.*/workflows/([0-9]+)/runs.*|\1|' <<<"$2")
      [ -f "$spec/RUNS_$id" ] && { cat "$spec/RUNS_$id"; exit 0; }
      echo '{"workflow_runs":[]}'; exit 0 ;;
  esac
fi
exit 0
BLIND2
chmod +x "$d/bin/gh"
out=$( cd "$d" && PATH="$d/bin:$PATH" GH_SPEC="$d/spec" OWNER=acme REPO=widget \
       SECRET_NAMES=$'PROVIDED\nOTHER' bash "$AUDIT" --static 2>&1 ); rc=$?
grep -q "PROVIDED" <<<"$out" && bad "charged a secret the context says exists" || ok "SECRET_NAMES satisfies a referenced secret"
grep -q "ABSENT_ONE" <<<"$out" && ok "still bites on one the context does NOT list" || bad "SECRET_NAMES suppressed a real phantom"
[ $rc -eq 1 ] && ok "the check BITES in CI rather than withholding forever" || bad "withheld despite having the names (exit $rc)"
grep -q "WITHHELD" <<<"$out" && bad "withheld even though SECRET_NAMES was supplied" || ok "does not withhold when the names are supplied"

# =============================================================================
echo
echo "audit-health — --static judges the DIFF, never the world"
# A red audit plus a clean secret list: --static must stay quiet, because a red
# elsewhere in the fleet is not this branch's doing. Gating a PR on it blocked
# every unrelated PR in the repo on someone else's outage.
d=$(new_case)
mkwf "$d" world.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/world.yml","name":"W","state":"active"}]}' > "$d/spec/WFLIST"
runrow failure 1 > "$d/spec/RUNS_1"
out=$( cd "$d" && PATH="$d/bin:$PATH" GH_SPEC="$d/spec" OWNER=acme REPO=widget bash "$AUDIT" --static 2>&1 ); rc=$?
[ $rc -eq 0 ] && ok "a RED audit does not fail --static" || bad "--static gated the branch on the world's state"
grep -q "RED" <<<"$out" && bad "--static rendered the live verdict anyway" || ok "--static does not even report the live verdict"

# ...but a phantom secret IS the diff's doing, so --static must still bite.
d=$(new_case)
mkwf "$d" world2.yml '17 6 * * 1' "        env:
          GH_TOKEN: \${{ secrets.GHOST || secrets.GITHUB_TOKEN }}"
echo '{"workflows":[{"id":1,"path":".github/workflows/world2.yml","name":"W2","state":"active"}]}' > "$d/spec/WFLIST"
runrow success 1 > "$d/spec/RUNS_1"
out=$( cd "$d" && PATH="$d/bin:$PATH" GH_SPEC="$d/spec" OWNER=acme REPO=widget bash "$AUDIT" --static 2>&1 ); rc=$?
[ $rc -eq 1 ] && ok "--static still bites on a phantom secret" || bad "--static missed a phantom"
grep -q "GHOST" <<<"$out" && ok "names it" || bad "phantom not named in --static"

# =============================================================================
echo
echo "audit-health — non-audit workflows are excluded"
d=$(new_case)
mkwf "$d" ci.yml '17 6 * * 1'
echo '{"workflows":[{"id":1,"path":".github/workflows/ci.yml","name":"CI","state":"active"}]}' > "$d/spec/WFLIST"
runrow failure 1 > "$d/spec/RUNS_1"
out=$(run_case "$d"); rc=$?
[ $rc -eq 0 ] && ok "the repo's own ci.yml is not treated as a fleet audit" || bad "ci.yml counted as an audit"

echo
echo "audit-health tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
exit 0
