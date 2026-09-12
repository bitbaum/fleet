#!/usr/bin/env bash
#
# Ephemeral repos: find them, archive them, delete them.
#
# The fleet creates repos automatically now — FleetCrown provisions one per
# project, and agents scaffold dogfood sites to test that path. Six of them
# appeared in two days (2026-09-10/11), every one a 20-54KB scaffold with no
# entry in apps.conf, and together they were 15 of the 26 gaps that were about
# to turn the version-currency ratchet red against a committed baseline of 0.
#
# That is how a ratchet dies: not disputed, just drowned. A gate whose number
# is mostly noise gets muted, and every real finding inside it goes with it.
#
# So a throwaway repo must SAY it is a throwaway, at birth, on the repo itself
# rather than in a list somebody has to remember to update. The marker is a
# GitHub topic, `fleet-ephemeral`, because:
#   - it travels with the repo, so every tool that can see the repo can see it;
#   - `gh repo list --json repositoryTopics` returns it, so no second registry;
#   - it is visible on the repo page, so a human meets it too.
#
# THE HOUSE RULE IS DELETION, AND THIS SCRIPT DEFERS TO IT.
#
# ~/.claude/CLAUDE.md, "Clean up the experiment when the experiment is over":
# an experiment is torn down in the SAME session that created it, repo included
# — "Not archived, not left private: gone." So `--delete` is the action this
# script is for. `--archive` exists only as a holding position for a repo you
# are genuinely unsure about; a fleet of archived experiments is the same mess
# with a quieter name.
#
# What this script adds is the BACKSTOP, because the rule covers the session
# that creates a repo and nothing covers the session that dies, is interrupted,
# or forgets. Six repos survived exactly that way. Marking at birth is
# insurance against the cleanup not happening: it lets a later sweep find what
# an earlier session left behind, without anyone having to recognise a name.
#
# Per-project teardown of a deployed site belongs to fleetcrown
# (`scripts/hetzner/retire-site.sh`, which also owns the Caddy vhost and the
# apps.conf row). This is the org-wide sweep for what that missed — do not
# grow it into a second teardown tool.
#
# Marking is authorization. This script will not touch a repo that is not
# marked, whatever its name looks like; "it is obviously a test repo" is
# exactly the reasoning that eventually deletes something real.

set -euo pipefail

OWNER="${GH_OWNER:-bitbaum}"
TOPIC="${EPHEMERAL_TOPIC:-fleet-ephemeral}"
LIMIT="${GH_LIMIT:-200}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--archive | --delete] [--yes] [--mark REPO ...]

  (no flags)      List marked repos. Read-only. This is the default on purpose.
  --delete --yes  Delete every marked repo. This is the intended action: the
                  house rule for an experiment is gone, not archived.
  --archive       Archive instead. A holding position for a repo you are unsure
                  about — reversible, and it leaves every org sweep alone.
  --mark REPO     Add the '$TOPIC' topic to an existing repo (backfill), then exit.
  --yes           Confirm a destructive action. Without it, --delete only prints.

Environment: GH_OWNER (default $OWNER), EPHEMERAL_TOPIC (default $TOPIC).
EOF
}

# ── the decision, as a pure function ─────────────────────────────────────────
#
# Reads `gh repo list --json name,isArchived,repositoryTopics` on stdin and
# writes one TSV row per repo the caller may act on. Kept separate from every
# network call so the self-test can drive it with fixtures and assert BOTH
# directions: a marked repo is selected, and an unmarked one never is.
#
# Prints: <name>\t<archived|live>
select_prunable() {
  local topic="$1"
  jq -r --arg topic "$topic" '
    .[]
    | select(.repositoryTopics != null)
    | select([.repositoryTopics[].name] | index($topic))
    | [.name, (if .isArchived then "archived" else "live" end)]
    | @tsv
  '
}

# ── argument parsing ─────────────────────────────────────────────────────────
ACTION="list"
CONFIRM="no"
MARK_REPOS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ACTION="archive" ;;
    --delete)  ACTION="delete" ;;
    --yes)     CONFIRM="yes" ;;
    --mark)
      shift
      [ $# -gt 0 ] || { echo "--mark needs a repo name" >&2; exit 2; }
      MARK_REPOS+=("$1")
      ;;
    -h|--help) usage; exit 0 ;;
    --selftest-select)
      # Used by test-prune-ephemeral-repos.sh: read fixture JSON on stdin.
      shift
      select_prunable "${1:-$TOPIC}"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
# FLEET_REPO_LIST_JSON injects the repo list instead of calling gh, so the
# self-test can drive the whole script — guards, actions and all — with no
# network. Without a seam like this the only testable part is the selector,
# and the guard that refuses `--delete` goes unproven, which is the one guard
# whose failure is unrecoverable.
[ -n "${FLEET_REPO_LIST_JSON:-}" ] || command -v gh >/dev/null || {
  echo "gh is required" >&2; exit 1; }

# ── backfill mode ────────────────────────────────────────────────────────────
if [ "${#MARK_REPOS[@]}" -gt 0 ]; then
  for r in "${MARK_REPOS[@]}"; do
    existing=$(gh repo view "$OWNER/$r" --json repositoryTopics \
                 --jq '[.repositoryTopics[]?.name] | join(",")' 2>/dev/null || true)
    # `gh repo edit --add-topic` is additive, so existing topics survive.
    if gh repo edit "$OWNER/$r" --add-topic "$TOPIC" >/dev/null 2>&1; then
      echo "marked $OWNER/$r  (topics were: ${existing:-none})"
    else
      echo "FAILED to mark $OWNER/$r — check the token's repo scope" >&2
    fi
  done
  exit 0
fi

# ── list ─────────────────────────────────────────────────────────────────────
if [ -n "${FLEET_REPO_LIST_JSON:-}" ]; then
  raw="$FLEET_REPO_LIST_JSON"
else
  raw=$(gh repo list "$OWNER" --limit "$LIMIT" \
          --json name,isArchived,repositoryTopics 2>/dev/null) || {
    echo "gh repo list failed — is gh authenticated?" >&2
    exit 1
  }
fi

rows=$(printf '%s' "$raw" | select_prunable "$TOPIC" || true)

if [ -z "$rows" ]; then
  # An empty result is reported as an empty result, never as success. A sweep
  # that found nothing and a sweep that could not look read identically
  # otherwise, and this repo has been bitten by that difference before.
  total=$(printf '%s' "$raw" | jq 'length')
  echo "no repos in $OWNER carry the '$TOPIC' topic (scanned $total)."
  echo "nothing to do. Mark one with: $(basename "$0") --mark <repo>"
  exit 0
fi

count=$(printf '%s\n' "$rows" | wc -l | tr -d ' ')
echo "$count repo(s) in $OWNER marked '$TOPIC':"
echo
printf '%s\n' "$rows" | while IFS=$'\t' read -r name state; do
  printf '  %-32s %s\n' "$name" "$state"
done
echo

case "$ACTION" in
  list)
    echo "read-only. The house rule is deletion — re-run with --delete --yes."
    echo "(--archive is a holding position, not the goal: an archived experiment"
    echo " is the same litter with a quieter name.)"
    ;;

  archive)
    printf '%s\n' "$rows" | while IFS=$'\t' read -r name state; do
      if [ "$state" = "archived" ]; then
        echo "  = $name already archived"
      elif gh repo archive "$OWNER/$name" --yes >/dev/null 2>&1; then
        echo "  ✓ archived $name"
      else
        echo "  ✗ FAILED to archive $name" >&2
      fi
    done
    echo
    echo "Archived repos are skipped by every org sweep that passes --no-archived."
    echo "Reverse any of them with: gh repo unarchive $OWNER/<name>"
    ;;

  delete)
    if [ "$CONFIRM" != "yes" ]; then
      echo "refusing to delete without --yes. Nothing was changed."
      echo "Re-run with --delete --yes once the list above is what you expect."
      exit 0
    fi
    printf '%s\n' "$rows" | while IFS=$'\t' read -r name state; do
      if gh repo delete "$OWNER/$name" --yes >/dev/null 2>&1; then
        echo "  ✓ deleted $name"
      else
        echo "  ✗ FAILED to delete $name — the token needs the delete_repo scope" >&2
        echo "    (gh auth refresh -h github.com -s delete_repo)" >&2
      fi
    done
    ;;
esac
