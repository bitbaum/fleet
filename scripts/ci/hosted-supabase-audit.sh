#!/usr/bin/env bash
#
# Fleet audit: does any repo still point at a HOSTED Supabase?
#
#   hosted-supabase-audit.sh [--check] [--list]
#
# WHY
#
# The fleet self-hosts Supabase on bitbaum. Two managed-cloud projects were
# retired — orangecat's `ohkueislstxomdjavyhs` in 2026-06 and botsmann's
# `jkjmhtirxwhljpkcfxqe` before it — but the repos kept describing them in the
# present tense. botsmann's setup doc opened with "Completed Setup" for the dead
# project and told you to apply migrations by pasting SQL into a dashboard we do
# not have. Nobody pasted anything, its eleven migrations were never applied,
# and /api/health served PGRST205 for months while every deploy went green.
#
# So this is not tidying. A wrong pointer to a real-looking place is worse than
# no pointer: no pointer makes someone ask, a plausible one makes them assume it
# was handled. The first live sweep, 2026-08-28, found one more of exactly that
# shape — printcraft/scripts/seed-roli-project.ts hardcoded the retired host AND
# omitted `db: { schema }`, so repointing it naively at the box would have
# written one customer's rows into orangecat's `public`.
#
# CENTRAL, NOT A COPY PER REPO — the rule this repo already lives by. Three
# repos use Supabase and thirty do not; a gate copied thirty times is the
# duplication SHARED.md measures. botsmann additionally keeps a local
# `check:selfhost` in its own verify, deliberately: it is the repo the outage
# happened in, and blocking the commit beats finding it a week later.
#
# WHY LOCAL CHECKOUTS RATHER THAN `gh api`, unlike verify-floor-audit.sh —
# that one reads ONE small file per repo, which is cheap remotely. This is a
# full-text sweep, and GitHub code search returns nothing for these repos
# (verified 2026-08-28: even a known-present token finds no hit), so the only
# remote option would be fetching every text file of every repo. Instead the
# workflow shallow-clones the fleet into a temp DEV_ROOT and runs this
# unchanged — the script never needs to know which it is looking at.
#
# THE BASELINE IS A RATCHET
#
# Some references are legitimate: a decommission runbook has to name the host it
# decommissioned, a migration history has to name what it moved off. Those live
# in hosted-supabase.baseline with a reason, decided once by a human. The list
# may FALL or hold; it may never RISE without that decision being visible in the
# same PR that adds the line.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEV_ROOT="${DEV_ROOT:-$HOME/dev}"
BASELINE="${BASELINE:-$HERE/hosted-supabase.baseline}"

# ---------------------------------------------------------------- pure helpers

# hosted_pattern — what counts as pointing at a hosted Supabase.
#
# `supabase.com/docs` is deliberately absent: the product documentation is still
# correct for us, only the control plane is not. A project ref is a long opaque
# token, so `your-project.supabase.co` in an example file stays legal — a
# placeholder misleads nobody, and a gate that fires on one gets muted.
hosted_pattern() {
  printf '%s' 'supabase\.com/dashboard|app\.supabase\.com|pooler\.supabase\.com|[a-z0-9]{15,}\.supabase\.co'
}

# is_exempt_path <path> — paths whose whole job is to describe the old world.
is_exempt_path() {
  case "$1" in
    docs/archive/*|*/docs/archive/*)                       return 0 ;;
    *hosted-supabase-audit.sh|*hosted-supabase.baseline)   return 0 ;;
    *test-hosted-supabase-audit.sh|*no-hosted-supabase.sh) return 0 ;;
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

# repo_ref <dir> — audit what is SHARED, not what a session happens to have
# checked out. A stale local main reports violations already fixed upstream:
# the first run of this audit did exactly that and blamed four clean repos.
repo_ref() {
  git -C "$1" rev-parse --verify -q origin/main   >/dev/null 2>&1 && { printf 'origin/main';   return; }
  git -C "$1" rev-parse --verify -q origin/master >/dev/null 2>&1 && { printf 'origin/master'; return; }
  printf 'HEAD'
}

if [ -n "${HOSTED_SUPABASE_AUDIT_LIB_ONLY:-}" ]; then return 0; fi

# ---------------------------------------------------------------------- sweep

MODE=check
case "${1:-}" in
  --check|"") MODE=check ;;
  --list)     MODE=list ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac

mapfile -t KEYS < <(baseline_keys "$BASELINE")
PATTERN="$(hosted_pattern)"

new_hits=(); seen_keys=(); scanned_repos=()

for gitdir in "$DEV_ROOT"/*/.git; do
  # A linked worktree's .git is a FILE, not a directory. Skipping them stops one
  # repo being audited twice under two names — the first run reported fleetcrown
  # and fleetcrown-scripts as separate offenders for a single line.
  [ -d "$gitdir" ] || continue
  repo_dir="${gitdir%/.git}"
  repo="$(basename "$repo_dir")"
  ref="$(repo_ref "$repo_dir")"
  scanned_repos+=("$repo")

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    path="${line%%:*}"
    rest="${line#*:}"
    is_exempt_path "$path" && continue
    key="$repo/$path"
    seen_keys+=("$key")
    in_baseline "$key" "${KEYS[@]:-}" || new_hits+=("$key:$rest")
  done < <(git -C "$repo_dir" grep -nEI "$PATTERN" "$ref" 2>/dev/null | sed "s|^$ref:||" || true)
done

# A runner with only this repo checked out would sweep nothing and pass. A
# vacuous pass reads exactly like coverage — the failure this audit exists to
# prevent — so say so out loud instead of printing a tick.
if [ ${#scanned_repos[@]} -eq 0 ]; then
  echo "⊘ hosted-Supabase audit SKIPPED — no fleet checkout under $DEV_ROOT."
  echo "  This is not a pass. Run it where the repos live."
  exit 0
fi

if [ "$MODE" = list ]; then
  printf '%s\n' "${seen_keys[@]:-}" | sort -u
  exit 0
fi

# A baseline entry whose reference is gone is a licence nobody needs. Only prune
# entries for repos actually scanned — an absent checkout is not proof.
stale=()
for k in "${KEYS[@]:-}"; do
  [ -n "$k" ] || continue
  [ -d "$DEV_ROOT/${k%%/*}/.git" ] || continue
  in_baseline "$k" "${seen_keys[@]:-}" || stale+=("$k")
done

if [ ${#new_hits[@]} -gt 0 ]; then
  echo "✗ hosted-Supabase reference(s) not in the baseline:" >&2
  printf '  %s\n' "${new_hits[@]}" >&2
  echo >&2
  echo "  The fleet self-hosts at supabase.orangecat.ch. If this is a live" >&2
  echo "  instruction, fix it. If it is a historical record, add the 'repo/path'" >&2
  echo "  line to $(basename "$BASELINE") WITH A REASON, in the same PR, so the" >&2
  echo "  exception is a decision and not an inheritance." >&2
  exit 1
fi

if [ ${#stale[@]} -gt 0 ]; then
  echo "✗ baseline entries with no matching reference — the ratchet must fall:" >&2
  printf '  %s\n' "${stale[@]}" >&2
  echo "  Delete these lines from $(basename "$BASELINE")." >&2
  exit 1
fi

echo "✓ ${#scanned_repos[@]} repos swept, no hosted-Supabase reference outside the baseline (${#seen_keys[@]} allowed)"
