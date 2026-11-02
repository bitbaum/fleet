#!/usr/bin/env bash
#
# Tests for the Google Fonts audit: it must catch every way an app still loads
# from Google, and stay quiet on the files that explain why they stopped — a
# gate that fires on a comment gets muted, and a muted gate protects nothing.
#
# Pure: no network, no fleet checkout.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/google-fonts-audit.sh"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || no "$3 (want '$1', got '$2')"; }
matches()  { grep -qE "$(google_pattern)" <<<"$1" && ok "$2" || no "$2 (should match)"; }
no_match() { grep -qE "$(google_pattern)" <<<"$1" && no "$2 (should NOT match)" || ok "$2"; }

export GOOGLE_FONTS_AUDIT_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT"
unset GOOGLE_FONTS_AUDIT_LIB_ONLY
# Sourcing runs the audit's `set -e` in this shell; a suite of failing commands
# must not stop at the first one.
set +e

echo "google_pattern — every way a build or a browser fetches from Google"
matches "import { Inter } from 'next/font/google';"                       "the import kivvi's held deploy came from"
matches 'import { Cormorant_Garamond, Inter } from "next/font/google";'  "double quotes"
matches "const { Geist } = require('next/font/google')"                   "a require"
matches '<link rel="preconnect" href="https://fonts.googleapis.com" />'   "a preconnect: the browser still asks Google"
matches "@import url('https://fonts.googleapis.com/css2?family=Inter');"  "a CSS @import"
matches 'src: url(https://fonts.gstatic.com/s/inter/v13/x.woff2)'         "a gstatic face URL"

echo
echo "google_pattern — what must stay legal"
no_match "import localFont from 'next/font/local';"                       "next/font/local is the fix"
no_match 'the next/font/google loader downloads at build time'            "prose naming the loader"
no_match 'served from fonts.gstatic.com before'                           "a host named without a URL"

echo
echo "is_comment — a line ABOUT Google is not a line that calls it"
is_comment "// next/font/google fetched these from https://fonts.gstatic.com" && ok "a // comment"   || no "// should be a comment"
is_comment " * https://fonts.googleapis.com/css2 was the old source"         && ok "a JSDoc line"   || no "* should be a comment"
is_comment "# https://fonts.googleapis.com"                                  && ok "a # comment"    || no "# should be a comment"
is_comment "{/* <link href=\"https://fonts.googleapis.com\"> */}"            && ok "a JSX comment"  || no "JSX comment should be a comment"
is_comment "import { Inter } from 'next/font/google';"                       && no "code is not a comment" || ok "code is judged"

echo
echo "is_exempt_path — files that name the pattern without using it"
is_exempt_path 'apps/web/lib/__tests__/fonts.test.ts' && ok "kivvi's ban test"           || no "a test should be exempt"
is_exempt_path 'app/fonts.test.ts'                    && ok "vitareba's ban test"        || no "a .test. file should be exempt"
is_exempt_path 'README.md'                            && ok "markdown"                   || no "markdown should be exempt"
is_exempt_path 'scripts/fetch-fonts.mjs'              && ok "a vendoring tool"           || no "fetch-fonts should be exempt"
is_exempt_path 'fonts/faces.json'                     && ok "the faces' provenance"     || no "faces.json should be exempt"
is_exempt_path 'src/app/layout.tsx'                   && no "a layout must be judged"    || ok "a layout is judged"
is_exempt_path 'src/app/globals.css'                  && no "a stylesheet must be judged" || ok "a stylesheet is judged"

echo
echo "baseline_keys / in_baseline — exact keys, reasons stripped"
TMP="$(mktemp)"
printf '# header\n\nfoo/a.tsx  # why\n  \nbar/b.ts\n' > "$TMP"
eq 'foo/a.tsx
bar/b.ts' "$(baseline_keys "$TMP")" "reasons stripped, blanks dropped"
in_baseline 'a/b.tsx' 'a/b.tsx.bak' && no "a longer path must not match" || ok "no substring match"

echo
echo "the sweep — over a real repository"
D="$(mktemp -d)"
trap 'rm -rf "$D" "$TMP"' EXIT
mkdir -p "$D/app/src/app" "$D/app/lib/__tests__"
printf "import { Inter } from 'next/font/google';\n" > "$D/app/src/app/layout.tsx"
printf "// moved off next/font/google and https://fonts.gstatic.com\nimport localFont from 'next/font/local';\n" > "$D/app/src/app/fonts.ts"
printf "expect(src).not.toMatch(/from 'next\\/font\\/google'/)\n" > "$D/app/lib/__tests__/fonts.test.ts"
git -C "$D/app" init -q
git -C "$D/app" add -A
git -C "$D/app" -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qm init
eq 'src/app/layout.tsx:1:import { Inter } from '"'"'next/font/google'"'"';' "$(hits "$D/app")" "only the layout is a hit"
out="$(DEV_ROOT="$D" BASELINE=/dev/null bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 1 "$rc" "an unlisted hit fails"
grep -q 'app/src/app/layout.tsx' <<<"$out" && ok "and names repo/path" || no "should name the file"
printf 'app/src/app/layout.tsx  # migrating\n' > "$TMP"
out="$(DEV_ROOT="$D" BASELINE="$TMP" bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 0 "$rc" "a listed hit passes"
printf 'app/src/app/layout.tsx  # migrating\napp/src/app/old.tsx  # gone\n' > "$TMP"
out="$(DEV_ROOT="$D" BASELINE="$TMP" bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 1 "$rc" "a stale entry fails: the ratchet must fall"
out="$(DEV_ROOT=/nonexistent bash "$SCRIPT" --check 2>&1)"; rc=$?
eq 0 "$rc" "no checkout exits 0"
grep -q 'SKIPPED' <<<"$out" && ok "but says SKIPPED" || no "must announce the skip"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
