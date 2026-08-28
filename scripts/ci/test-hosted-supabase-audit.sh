#!/usr/bin/env bash
#
# Tests for the hosted-Supabase audit — chiefly the two judgements that decide
# whether it is useful or merely loud.
#
#   1. It must catch a REAL pointer: a dashboard link, a pooler host, a project
#      ref. botsmann's setup doc carried all three shapes, and the app served
#      PGRST205 for months because nobody could tell they were dead.
#   2. It must NOT catch a placeholder or the product docs. A gate that fires on
#      `your-project.supabase.co`, or on a link to supabase.com/docs, gets muted
#      — and a muted gate protects nothing.
#
# Pure: no network, no box, no fleet checkout.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/hosted-supabase-audit.sh"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || no "$3 (want '$1', got '$2')"; }
matches()  { printf '%s' "$1" | grep -qE "$(hosted_pattern)" && ok "$2" || no "$2 (should match)"; }
no_match() { printf '%s' "$1" | grep -qE "$(hosted_pattern)" && no "$2 (should NOT match)" || ok "$2"; }

export HOSTED_SUPABASE_AUDIT_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT"
unset HOSTED_SUPABASE_AUDIT_LIB_ONLY

echo "hosted_pattern — the shapes that actually misled someone"
matches 'https://supabase.com/dashboard/project/_/sql'                "a dashboard link, botsmann's documented migration step"
matches 'https://supabase.com/dashboard/account/tokens'               "the account-tokens link orangecat's runbook carried"
matches 'https://app.supabase.com'                                    "the older app. host"
matches 'psql -h aws-0-eu-central-1.pooler.supabase.com -p 6543'      "a pooler connection string"
matches 'https://jkjmhtirxwhljpkcfxqe.supabase.co'                    "botsmann's retired project ref"
matches 'https://ckpynkpsfnuqndplaapc.supabase.co'                    "printcraft's retired project ref"
matches 'db.ohkueislstxomdjavyhs.supabase.co:5432'                    "orangecat's, inside a pg_dump URL"

echo
echo "hosted_pattern — what must stay legal, or the gate gets muted"
no_match 'https://supabase.com/docs/guides/storage'                   "product docs are still correct for us"
no_match 'https://supabase.com/docs'                                  "a bare docs link"
no_match 'NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"' "a placeholder misleads nobody"
no_match 'https://supabase.orangecat.ch'                              "our own self-hosted host"
no_match 'import { createClient } from "@supabase/supabase-js"'       "the package name is not a host"

echo
echo "is_exempt_path — paths whose job is to describe the old world"
is_exempt_path 'docs/archive/2026-h1/NOTES.md'       && ok "docs/archive is history, not instruction"  || no "docs/archive should be exempt"
is_exempt_path 'app/docs/archive/OLD.md'             && ok "a nested docs/archive too"                 || no "nested archive should be exempt"
is_exempt_path 'scripts/ci/hosted-supabase.baseline' && ok "the baseline names the refs it allows"     || no "baseline should be exempt"
is_exempt_path 'scripts/ci/no-hosted-supabase.sh'    && ok "botsmann's local gate states the patterns" || no "local gate should be exempt"
is_exempt_path 'docs/operations/DECOMMISSION.md'     && no "a live runbook must NOT be auto-exempt"    || ok "a runbook is judged, not waved through"
is_exempt_path '.env.example'                        && no ".env.example must NOT be auto-exempt"      || ok ".env.example is judged"

echo
echo "baseline_keys — comments and blanks are not licences"
TMP="$(mktemp)"
printf '# a header\n\nfoo/bar.md  # why it is allowed\n\n  \nbaz/qux.ts\n' > "$TMP"
eq 'foo/bar.md
baz/qux.ts' "$(baseline_keys "$TMP")" "reasons stripped, blanks dropped, keys kept"
eq '' "$(baseline_keys /nonexistent/baseline)" "a missing baseline allows nothing, and does not crash"

echo
echo "in_baseline — exact keys, so a prefix cannot smuggle a file through"
in_baseline 'a/b.md' 'a/b.md' 'c/d.md' && ok "an exact key is allowed"          || no "exact key should match"
in_baseline 'a/b.md' 'a/b.md.bak'      && no "a longer path must not match"     || ok "no substring match"
in_baseline 'a/b.md' 'x/y.md'          && no "an unrelated key must not match"  || ok "unrelated key rejected"
in_baseline 'a/b.md'                   && no "an empty baseline allows nothing" || ok "empty baseline allows nothing"

echo
echo "repo_ref — audit what is SHARED, not a session's stale checkout"
D="$(mktemp -d)"
trap 'rm -rf "$D" "$TMP"' EXIT
git -C "$D" init -q 2>/dev/null
git -C "$D" commit -q --allow-empty -m init 2>/dev/null
eq HEAD "$(repo_ref "$D")" "no remote falls back to HEAD rather than failing the sweep"
git -C "$D" update-ref refs/remotes/origin/main HEAD
eq origin/main "$(repo_ref "$D")" "origin/main wins — a local main 4 commits stale reports fixed files as broken"

echo
echo "the sweep must never pass vacuously"
out="$(DEV_ROOT=/nonexistent bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 0 "$rc" "no checkout exits 0, so a runner without the fleet is not a red herring"
printf '%s' "$out" | grep -q 'SKIPPED' && ok "but it says SKIPPED — a vacuous pass would read as coverage" \
                                        || no "must announce the skip, not print a tick"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
