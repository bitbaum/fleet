#!/usr/bin/env bash
#
# Fleet audit: does any repo still load fonts from Google?
#
#   google-fonts-audit.sh [--check] [--list]
#
# WHY
#
# `next/font/google` downloads its faces during `next build`. A build therefore
# depends on fonts.googleapis.com answering from wherever it runs, and on
# 2026-11-02 one that did not held kivvi's main deploy ("Cannot read properties
# of null (reading '1')"). A `<link>` or `@import` of fonts.googleapis.com does
# the same to every visitor instead: their browser asks Google before the page
# can draw its type.
#
# The faces the fleet uses ship in @bitbaum/design-tokens (fonts/, listed in
# fonts/faces.json), and `design-tokens-next-fonts` writes an app's
# `next/font/local` module from them. So any of these is a finding:
#
#   * importing or requiring `next/font/google`
#   * a URL on fonts.googleapis.com or fonts.gstatic.com in code or markup
#
# Comment lines are not judged — a file that explains why it left Google has to
# name what it left — and neither are tests (a test that bans the import names
# it) nor markdown.
#
# CENTRAL, NOT A COPY PER REPO: kivvi and vitareba each wrote their own test
# banning the import. A gate copied into every app is the duplication SHARED.md
# measures, and it covers only the apps someone remembered. This sweeps every
# repo, the same way hosted-supabase-audit.sh does, from shallow clones.
#
# THE BASELINE IS A RATCHET
#
# google-fonts.baseline lists the files that still load from Google, each with
# where its migration stands. The list may FALL or hold. It may never RISE
# without a human deciding so in the same PR that adds the line, and an entry
# whose file no longer matches must be deleted.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEV_ROOT="${DEV_ROOT:-$HOME/dev}"
BASELINE="${BASELINE:-$HERE/google-fonts.baseline}"

# ---------------------------------------------------------------- pure helpers

# google_pattern — code that makes a build or a browser fetch from Google Fonts.
google_pattern() {
  printf '%s' "(from|import|require\\()[[:space:]]*\\(?[[:space:]]*['\"]next/font/google['\"]|https?://fonts\\.(googleapis|gstatic)\\.com"
}

# is_comment <line> — a line ABOUT Google, not a line that calls it.
is_comment() {
  local t="${1#"${1%%[![:space:]]*}"}"
  case "$t" in
    //*|\#*|\**|/\**|\<!--*|\{/\**) return 0 ;;
    *) return 1 ;;
  esac
}

# is_exempt_path <path> — paths that name the pattern without using it.
is_exempt_path() {
  case "$1" in
    *.md|*.mdx|*.txt)                                         return 0 ;;
    *.test.*|*.spec.*|*/__tests__/*|*/tests/*|tests/*|*/test/*|test/*|*/e2e/*|e2e/*) return 0 ;;
    *google-fonts-audit.sh|*google-fonts.baseline)            return 0 ;;
    # A maintainer's tool that vendors faces FROM Google is how they stop being
    # fetched at build time (design-tokens, petvity); nothing in a build runs it.
    # ...and the record of where each face came from (design-tokens fonts/faces.json).
    *fetch-fonts.*|*/faces.json)                              return 0 ;;
    docs/archive/*|*/docs/archive/*)                          return 0 ;;
    *pnpm-lock.yaml|*package-lock.json|*yarn.lock)            return 0 ;;
    *) return 1 ;;
  esac
}

# baseline_keys <file> — `repo/path` per line, comments and blanks dropped.
baseline_keys() {
  [ -f "$1" ] || return 0
  sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^[[:space:]]*$/d' "$1"
}

# in_baseline <key> <keys...> — exact match, so a prefix cannot smuggle a file in.
in_baseline() {
  local key="$1"; shift
  local k
  for k in "$@"; do [ "$k" = "$key" ] && return 0; done
  return 1
}

# repo_ref <dir> — audit what is SHARED, not a session's stale checkout.
repo_ref() {
  git -C "$1" rev-parse --verify -q origin/main   >/dev/null 2>&1 && { printf 'origin/main';   return; }
  git -C "$1" rev-parse --verify -q origin/master >/dev/null 2>&1 && { printf 'origin/master'; return; }
  printf 'HEAD'
}

# hits <dir> — `path:line:text` for every judged line in the repo's shared branch.
hits() {
  local dir="$1" ref line path rest text
  ref="$(repo_ref "$dir")"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    line="${line#"$ref":}"
    path="${line%%:*}"
    rest="${line#*:}"
    text="${rest#*:}"
    is_exempt_path "$path" && continue
    is_comment "$text" && continue
    printf '%s\n' "$line"
  done < <(git -C "$dir" grep -nEI "$(google_pattern)" "$ref" -- . ':!**/node_modules/**' 2>/dev/null || true)
}

if [ -n "${GOOGLE_FONTS_AUDIT_LIB_ONLY:-}" ]; then return 0; fi

# ---------------------------------------------------------------------- sweep

MODE=check
case "${1:-}" in
  --check|"") MODE=check ;;
  --list)     MODE=list ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac

mapfile -t KEYS < <(baseline_keys "$BASELINE")

new_hits=(); seen_keys=(); scanned_repos=()

for gitdir in "$DEV_ROOT"/*/.git; do
  # A linked worktree's .git is a file: skip it, or one repo is audited twice.
  [ -d "$gitdir" ] || continue
  repo_dir="${gitdir%/.git}"
  repo="$(basename "$repo_dir")"
  scanned_repos+=("$repo")
  while IFS= read -r line; do
    path="${line%%:*}"
    key="$repo/$path"
    in_baseline "$key" "${seen_keys[@]:-}" || seen_keys+=("$key")
    in_baseline "$key" "${KEYS[@]:-}" || new_hits+=("$repo/$line")
  done < <(hits "$repo_dir")
done

# A runner with only this repo checked out would sweep nothing and pass. Say so.
if [ ${#scanned_repos[@]} -eq 0 ]; then
  echo "⊘ Google Fonts audit SKIPPED — no fleet checkout under $DEV_ROOT."
  echo "  This is not a pass. Run it where the repos live."
  exit 0
fi

if [ "$MODE" = list ]; then
  printf '%s\n' "${seen_keys[@]:-}" | sed '/^$/d' | sort -u
  exit 0
fi

# An entry whose file no longer loads from Google is a licence nobody needs.
# Only for repos actually scanned: an absent checkout is not proof.
stale=()
for k in "${KEYS[@]:-}"; do
  [ -n "$k" ] || continue
  [ -d "$DEV_ROOT/${k%%/*}/.git" ] || continue
  in_baseline "$k" "${seen_keys[@]:-}" || stale+=("$k")
done

if [ ${#new_hits[@]} -gt 0 ]; then
  echo "✗ Google Fonts loaded outside the baseline:" >&2
  printf '  %s\n' "${new_hits[@]}" >&2
  echo >&2
  echo "  The faces ship in @bitbaum/design-tokens. Replace the call with the module" >&2
  echo "  'pnpm exec design-tokens-next-fonts' writes (its README, \"Faces for Next" >&2
  echo "  apps\"); a face it lacks is added to the package, not fetched from Google." >&2
  exit 1
fi

if [ ${#stale[@]} -gt 0 ]; then
  echo "✗ baseline entries that no longer load from Google — the ratchet must fall:" >&2
  printf '  %s\n' "${stale[@]}" >&2
  echo "  Delete these lines from $(basename "$BASELINE")." >&2
  exit 1
fi

echo "✓ ${#scanned_repos[@]} repos swept, no Google Fonts load outside the baseline (${#seen_keys[@]} still listed)"
