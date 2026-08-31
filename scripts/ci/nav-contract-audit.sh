#!/usr/bin/env bash
# Fleet audit: a navigation that STYLES the current page but never ANNOUNCES it.
#
# The rendered audit (ui-defect-audit.mjs) already checks this, but only where
# it can reach: the public entry page of each orangecat.ch site. Every sidebar
# behind a login is invisible to it by construction — and the bug that started
# this was on exactly such a sidebar. This is the other half: a source sweep
# that sees authed surfaces, every framework, and the sites on their own
# domains the renderer never visits.
#
# THE RULE IS REPO-LEVEL, DELIBERATELY.
#
# The first draft asserted this per FILE: a file that renders nav links and
# computes which one is current must contain `aria-current`. Run across the
# fleet it produced 19 findings of which roughly a quarter were wrong, because
# the active state and the announcement legitimately live in different files:
#
#   - evig spreads `{...navLinkProps(...)}`, a helper that supplies the
#     attribute — the literal string never appears in the component.
#   - fleetcrown's SidebarNav passes `current={...}` to SidebarNavItem, and the
#     child is what announces.
#   - a tab list correctly uses aria-selected, not aria-current.
#
# A gate that is wrong a quarter of the time gets ignored, and an ignored gate
# is worse than none because it manufactures confidence. So the assertion is
# the one that cannot be wrong: a repo whose navigation computes an active
# state must announce it SOMEWHERE. That catches the real class — a whole app
# where the highlight exists only for people who can see it — with no false
# positives. Per-surface stragglers are the rendered audit's job, because only
# a real DOM can tell which link actually got the attribute.
#
# CENTRAL, NOT A COPY PER REPO — the rule this repo already lives by.
#
# READS THE DEFAULT BRANCH, never the working tree: a local checkout sits on a
# feature branch as often as not. It reads the LAST-FETCHED origin ref and does
# not fetch, so a stale clone reports stale facts — the workflow clones fresh.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEV_ROOT="${DEV_ROOT:-$HOME/dev}"
BASELINE="${NAV_CONTRACT_BASELINE:-$HERE/nav-contract.baseline}"

NAV_PATH='(nav|sidebar|header|footer|menu)[^/]*\.(tsx|jsx|mjs|html)$'
ACTIVE='isActive|isCurrent|pathname *===|pathname\.startsWith|currentView|-active\b|data-active'
LINKS='<Link|<a [^>]*href|<NavLink'
TABS='aria-selected|role="tab"'
SKIP_FILE='(^|/)page\.(tsx|jsx)$|(^|/)[A-Za-z-]*sortable[A-Za-z-]*\.(tsx|jsx)$|(^|/)[A-Za-z-]*filter[A-Za-z-]*\.(tsx|jsx)$|(^|/)tabs?\.(tsx|jsx)$'
# Every alternative is anchored to a path boundary ((^|/)) so it matches a
# whole basename, never a substring. Unanchored, `tabs?\.(tsx|jsx)$` matched
# ANY file merely ending in "Tabs.tsx" — evig's AnalyseTabs.tsx included —
# and skipped it silently, which is exactly the kind of miss this script
# exists to prevent elsewhere.

offenders=()
evidence=()
repos_scanned=0
navfiles_scanned=0

allowed() {
  [ -f "$BASELINE" ] || return 1
  grep -vE '^\s*(#|$)' "$BASELINE" | awk '{print $1}' | grep -qxF "$1"
}

declare -A seen_remote=()
for gitdir in "$DEV_ROOT"/*/.git; do
  [ -e "$gitdir" ] || continue
  repo="$(dirname "$gitdir")"
  name="$(basename "$repo")"

  # Two directories are not two repos: fleetcrown/fleetcrown-scripts and
  # hirnli/revamp-info are each ONE repo cloned twice.
  remote="$(git -C "$repo" remote get-url origin 2>/dev/null || echo "local:$name")"
  remote="${remote%.git}"
  if [ -n "${seen_remote[$remote]:-}" ]; then continue; fi
  seen_remote[$remote]=1

  # `|| true`: origin/HEAD is unset in many clones. A question, not an error.
  branch="$(git -C "$repo" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)"
  [ -n "$branch" ] || branch=main
  git -C "$repo" rev-parse --verify -q "origin/$branch" >/dev/null 2>&1 || branch=master
  ref="origin/$branch"
  git -C "$repo" rev-parse --verify -q "$ref" >/dev/null 2>&1 || continue
  repos_scanned=$((repos_scanned + 1))

  mapfile -t candidates < <(
    {
      git -C "$repo" ls-tree -r --name-only "$ref" 2>/dev/null | grep -iE "$NAV_PATH" || true
      git -C "$repo" grep -l -I -E '<nav[ >]|role="navigation"' "$ref" \
        -- '*.tsx' '*.jsx' '*.mjs' '*.html' 2>/dev/null | sed "s|^$ref:||" || true
    } | grep -viE 'node_modules|/dist/|\.next/|__tests__|\.test\.|\.spec\.' \
      | grep -viE "$SKIP_FILE" | sort -u
  )

  hits=()
  for f in "${candidates[@]}"; do
    [ -n "$f" ] || continue
    body="$(git -C "$repo" show "$ref:$f" 2>/dev/null || true)"
    [ -n "$body" ] || continue
    navfiles_scanned=$((navfiles_scanned + 1))
    if printf '%s' "$body" | grep -qE "$TABS"; then continue; fi
    if ! printf '%s' "$body" | grep -qE "$LINKS"; then continue; fi
    if ! printf '%s' "$body" | grep -qE "$ACTIVE"; then continue; fi
    hits+=("$f")
  done

  # No nav computes an active state here — nothing to announce.
  if [ "${#hits[@]}" -eq 0 ]; then continue; fi

  # THE ASSERTION: somewhere in this repo, the current page is announced.
  if git -C "$repo" grep -q -I 'aria-current' "$ref" 2>/dev/null; then continue; fi
  if allowed "$name"; then continue; fi

  offenders+=("$name")
  evidence+=("$name|${hits[0]}|${#hits[@]}")
done

if [ "$repos_scanned" -eq 0 ] || [ "$navfiles_scanned" -eq 0 ]; then
  echo "⊘ nav-contract audit SKIPPED — no fleet checkout under $DEV_ROOT" >&2
  echo "  (scanned $navfiles_scanned nav file(s) across $repos_scanned repo(s))" >&2
  exit 2
fi

if [ "${#offenders[@]}" -gt 0 ]; then
  echo "nav-contract audit FAILED — ${#offenders[@]} repo(s) paint a current page they never announce:"
  echo
  for e in "${evidence[@]}"; do
    IFS='|' read -r r f n <<< "$e"
    echo "  $r — $n nav file(s) compute an active state, 0 aria-current in the repo"
    echo "      e.g. $f"
  done
  echo
  echo "The highlight exists only for people who can see it. Set aria-current=\"page\""
  echo "on the active link. If a repo's nav genuinely has no current page (a"
  echo "single-page tool whose nav is anchors), add it to $(basename "$BASELINE") with a reason."
  exit 1
fi

echo "nav-contract audit: ok — $navfiles_scanned nav file(s) across $repos_scanned repo(s), every repo announces its current page."
