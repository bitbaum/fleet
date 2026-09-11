#!/usr/bin/env bash
#
# Tests for the org-drift audit — the judgements that decide whether it catches
# real contradictions without false positives.
#
#   1. It must catch forbidden claims: "incorporation pending", "bitbaum AG",
#      "AI-first product studio" as what bitbaum is, github.io as a host.
#   2. It must NOT catch legitimate uses: private operational emails, historical
#      records in archive/ directories, or mentions that are clearly context.
#
# Pure: no network, no box, no fleet checkout.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/org-drift-audit.sh"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || no "$3 (want '$1', got '$2')"; }
matches()  { printf '%s' "$1" | grep -qE "$(forbidden_patterns | paste -sd'|' -)" && ok "$2" || no "$2 (should match)"; }
no_match() { printf '%s' "$1" | grep -qE "$(forbidden_patterns | paste -sd'|' -)" && no "$2 (should NOT match)" || ok "$2"; }

export ORG_DRIFT_AUDIT_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT"
unset ORG_DRIFT_AUDIT_LIB_ONLY

set +e

echo "forbidden_patterns — claims that contradict registers/org.json"
matches 'The incorporation pending status means...'           "incorporation pending is forbidden (legalStatus is unregistered)"
matches 'Welcome to bitbaum AG'                               "bitbaum AG is forbidden (no such entity)"
matches 'bitbaum is an AI-first product studio'               "AI-first product studio as identity is forbidden"
matches 'We are an AI product studio building...'             "AI product studio as identity is forbidden"
matches 'Deploy to github.io/bitbaum'                         "github.io/bitbaum is forbidden (host is Hetzner)"
matches 'Contact Georgy Butaev for more information'          "legal personal name is forbidden on public docs"

echo
echo "forbidden_patterns — legitimate mentions that must stay legal"
no_match 'Previously we considered incorporation'             "historical context, not a present-tense claim"
no_match 'AI-powered product features'                        "AI product ≠ AI product studio"
no_match 'studio@example.com'                                 "the word studio alone is not a claim"
no_match 'Check out github.com/bitbaum'                       "github.com is correct, github.io is not"

echo
echo "is_public_doc — only public-facing docs and marketing"
is_public_doc 'README.md'                     && ok "README is public"          || no "README should be public"
is_public_doc 'CLAUDE.md'                     && ok "CLAUDE.md is public"       || no "CLAUDE.md should be public"
is_public_doc 'AGENTS.md'                     && ok "AGENTS.md is public"       || no "AGENTS.md should be public"
is_public_doc 'docs/guide.md'                 && ok "docs/*.md is public"       || no "docs markdown should be public"
is_public_doc 'site/index.html'               && ok "site/*.html is public"     || no "site html should be public"
is_public_doc 'src/lib/internal.ts'           && no "source code is not public" || ok "source code correctly excluded"
is_public_doc '.github/workflows/ci.yml'      && no "CI config is not public"   || ok "CI config correctly excluded"
is_public_doc 'package.json'                  && no "package.json is not public" || ok "package.json correctly excluded"

echo
echo "is_exempt_path — paths whose job is to describe history"
is_exempt_path 'docs/archive/2025/old.md'          && ok "docs/archive is history"          || no "archive should be exempt"
is_exempt_path 'scripts/ci/org-drift-audit.sh'     && ok "the audit script names patterns"  || no "script should be exempt"
is_exempt_path 'scripts/ci/org-drift.baseline'     && ok "the baseline lists violations"    || no "baseline should be exempt"
is_exempt_path 'registers/org.json'                && ok "the register is the source"       || no "register should be exempt"
is_exempt_path 'README.md'                         && no "README is judged, not exempt"     || ok "README correctly not exempt"

echo
echo "baseline_keys — comments and blanks are not licences"
TMP="$(mktemp)"
printf '# a header\n\nfoo/README.md  # historical reference\n\n  \nbar/CLAUDE.md\n' > "$TMP"
eq 'foo/README.md
bar/CLAUDE.md' "$(baseline_keys "$TMP")" "reasons stripped, blanks dropped, keys kept"
eq '' "$(baseline_keys /nonexistent/baseline)" "a missing baseline allows nothing"

echo
echo "in_baseline — exact keys only"
in_baseline 'a/README.md' 'a/README.md' 'c/d.md' && ok "exact key is allowed"          || no "exact key should match"
in_baseline 'a/README.md' 'a/README.md.bak'      && no "longer path must not match"     || ok "no substring match"
in_baseline 'a/README.md' 'x/y.md'               && no "unrelated key must not match"   || ok "unrelated key rejected"

echo
echo "repo_ref — audit what is SHARED"
D="$(mktemp -d)"
trap 'rm -rf "$D" "$TMP"' EXIT
git -C "$D" init -q 2>/dev/null
git -C "$D" -c user.email=test@example.invalid -c user.name=test \
    -c commit.gpgsign=false commit -q --allow-empty -m init 2>/dev/null
eq HEAD "$(repo_ref "$D")" "no remote falls back to HEAD"
git -C "$D" update-ref refs/remotes/origin/main HEAD
eq origin/main "$(repo_ref "$D")" "origin/main wins"

echo
echo "parse_apps_conf_doors — extract domain→repo mappings"
APPS_CONF='# comment
name|4001|example.orangecat.ch|/home/g/dev/example-repo|.|db|owner|kind|status|-|-|-
other|4002|multi.orangecat.ch,second.orangecat.ch|/home/g/dev/multi-repo|.|db|owner|kind|status|-|-|-
internal|4003|-|/home/g/dev/internal|.|db|owner|kind|status|-|-|-'

result="$(echo "$APPS_CONF" | parse_apps_conf_doors)"
printf '%s' "$result" | grep -q 'example.orangecat.ch|example-repo'     && ok "single domain extracted"  || no "single domain failed"
printf '%s' "$result" | grep -q 'multi.orangecat.ch|multi-repo'         && ok "first multi-domain"       || no "first multi-domain failed"
printf '%s' "$result" | grep -q 'second.orangecat.ch|multi-repo'        && ok "second multi-domain"      || no "second multi-domain failed"
printf '%s' "$result" | grep -q -- '-|internal'                         && no "dash domain excluded"     || ok "dash correctly excluded"

echo
echo "the sweep must never pass vacuously"
# INVENTORY is redirected to a temp file, and that is not tidiness. Without it
# this case runs the real script with the real default, so a test whose whole
# point is "scan nothing" OVERWROTE the committed 41-repo inventory with
# "Scanned 0 repos, found 0 violation(s)" — the tracked record of the fleet's
# drift, replaced by the output of a deliberately empty run, every time anyone
# ran the tests. A check that damages the artifact it checks is the same shape
# as a reader that deletes the evidence.
out="$(USE_LOCAL=1 DEV_ROOT=/nonexistent REGISTER=/dev/null INVENTORY="$(mktemp)" bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 0 "$rc" "no checkout exits 0"
printf '%s' "$out" | grep -q 'SKIPPED' && ok "announces the skip" || no "must announce skip"

echo
echo "retired names and hosts — registers/retired.json"

# A fixture, not the real register: these assertions are about the MECHANISM,
# and pinning them to live data would make the test fail every time someone
# retires something. Includes a regex metacharacter (the dots) and an ampersand
# on purpose.
RETIRED_FIXTURE="$(mktemp)"
trap 'rm -f "$RETIRED_FIXTURE"' EXIT
cat > "$RETIRED_FIXTURE" <<'JSON'
{ "retired": [
  { "kind": "host", "from": "old.example.ch", "to": "new.example.ch",
    "since": "2026-01-02", "why": "moved" },
  { "kind": "name", "from": "Old & Busted", "to": "New Hotness",
    "since": "2026-01-03", "why": "renamed" }
] }
JSON
RETIRED="$RETIRED_FIXTURE"

eq 2 "$(retired_entries | grep -c .)" "both entries parse"
eq "old.example.ch|new.example.ch|2026-01-02|moved" "$(retired_entries | head -1)" "fields survive in order"

# The dots MUST be escaped, or the pattern is a wildcard: an unescaped
# old.example.ch also matches oldXexampleYch, and a check that matches more than
# it names is a check nobody can reason about.
pat="$(retired_patterns | head -1)"
eq 'old\.example\.ch' "$pat" "regex metacharacters are escaped"
printf '%s' "see oldXexampleYch here" | grep -qE "$pat" \
  && no "escaped pattern must not match a wildcard variant" \
  || ok "escaped pattern does not match a wildcard variant"
printf '%s' "see old.example.ch here" | grep -qE "$pat" \
  && ok "escaped pattern still matches the real thing" \
  || no "escaped pattern stopped matching the real thing"

# An ampersand is not an ERE metacharacter, but it IS special in a sed
# replacement — if the escaper mangled it, the pattern would silently stop
# matching the very name it was written for.
amp="$(retired_patterns | tail -1)"
grep -qE "$amp" <<< "the Old & Busted thing" \
  && ok "a name containing '&' still matches" \
  || no "a name containing '&' stopped matching (sed replacement ate it)"

hint="$(retired_hint 'we link old.example.ch in the readme')" && rc=0 || rc=1
eq 0 "$rc" "a line using a retired form yields a hint"
printf '%s' "$hint" | grep -q 'new.example.ch' && ok "the hint names the replacement" || no "hint must name the replacement"
printf '%s' "$hint" | grep -q '2026-01-02' && ok "the hint dates the retirement" || no "hint must carry the date"

retired_hint 'this document is entirely current' >/dev/null 2>&1 \
  && no "a clean line must NOT yield a hint" \
  || ok "a clean line yields no hint"

# The document that RECORDS a retirement must not be a violation of it —
# otherwise the register indicts itself and the ratchet can never reach zero.
is_exempt_path "registers/retired.json" && ok "the retired register is exempt" || no "retired register must be exempt"
is_exempt_path "fleet/registers/retired.json" && ok "exempt under a repo prefix too" || no "prefixed path must be exempt"

# A missing register is not a crash and not a silent pass of a different check:
# it simply contributes no patterns.
RETIRED=/nonexistent
eq 0 "$(retired_entries | grep -c . || true)" "a missing register contributes nothing"
RETIRED="$RETIRED_FIXTURE"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
