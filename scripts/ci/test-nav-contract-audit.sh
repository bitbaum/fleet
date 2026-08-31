#!/usr/bin/env bash
#
# Self-test for nav-contract-audit.sh, run BEFORE the real sweep for the same
# reason test-hosted-supabase-audit.sh runs before that one: a detector that
# has silently stopped catching anything reports a clean fleet, and a clean
# report from a broken detector is worse than no report — it is an absent
# check that produces a tick.
#
# Builds tiny synthetic git repos under a scratch DEV_ROOT and points the
# audit at them, rather than sourcing internals — the script under test is a
# straight-through sweep, not a library of functions. Each fixture pins one
# side of a judgement the real sweep had to make on 2026-08-31:
#
#   1. catches a real defect (styles isActive, never announces it)
#   2. stays quiet on a repo with no nav computing an active state at all
#   3. stays quiet on a repo that already announces correctly
#   4. stays quiet on a tab list correctly using aria-selected
#      (this exact false positive fired on evig's AnalyseTabs before the
#      audit was narrowed to a repo-level assertion)
#   5. the baseline suppresses a named repo
#   6. two directories with the same origin remote count as one repo
#
# Pure: no network, no real fleet checkout.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/nav-contract-audit.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

# make_repo <dev_root> <name> <file_path> <file_content> [origin_url]
make_repo() {
  local root="$1" name="$2" file="$3" content="$4" origin="${5:-}"
  local dir="$root/$name"
  mkdir -p "$dir/$(dirname "$file")"
  printf '%s' "$content" > "$dir/$file"
  git -C "$dir" init -q -b main
  git -C "$dir" -c user.email=t@test -c user.name=t -c commit.gpgsign=false \
    add -A
  git -C "$dir" -c user.email=t@test -c user.name=t -c commit.gpgsign=false \
    -c core.hooksPath=/dev/null commit -q -m init
  # The audit reads a REMOTE-TRACKING ref (origin/<branch>), never a local
  # branch — a bare `git init` fixture has no such ref until something fetches
  # it. Fake the ref directly rather than standing up a real remote.
  git -C "$dir" update-ref refs/remotes/origin/main "$(git -C "$dir" rev-parse HEAD)"
  if [ -n "$origin" ]; then
    git -C "$dir" remote add origin "$origin"
  fi
}

run_audit() {
  local root="$1"
  DEV_ROOT="$root" bash "$SCRIPT" 2>&1
  echo "EXIT:$?"
}

# ── 1. catches a real defect ────────────────────────────────────────────────
d="$SCRATCH/case1"
make_repo "$d" broken-repo "components/Nav.tsx" '
export function Nav({ pathname }) {
  return (
    <nav>
      {items.map(i => (
        <Link href={i.href} className={pathname === i.href ? "active" : ""}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
'
out="$(run_audit "$d")"
if echo "$out" | grep -q "EXIT:1" && echo "$out" | grep -q "broken-repo"; then
  ok "catches a repo that styles the current page and never announces it"
else
  no "should have failed and named broken-repo, got: $out"
fi

# ── 2. quiet when nothing computes an active state ──────────────────────────
d="$SCRATCH/case2"
make_repo "$d" static-repo "components/Footer.tsx" '
export function Footer() {
  return (
    <nav>
      <Link href="/a">A</Link>
      <Link href="/b">B</Link>
    </nav>
  );
}
'
out="$(run_audit "$d")"
if echo "$out" | grep -q "EXIT:0"; then
  ok "stays quiet on a nav with no active-state computation (nothing to announce)"
else
  no "should have passed, got: $out"
fi

# ── 3. quiet when it already announces correctly ────────────────────────────
d="$SCRATCH/case3"
make_repo "$d" correct-repo "components/Nav.tsx" '
export function Nav({ pathname }) {
  return (
    <nav>
      {items.map(i => (
        <Link href={i.href} aria-current={pathname === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
'
out="$(run_audit "$d")"
if echo "$out" | grep -q "EXIT:0"; then
  ok "stays quiet on a repo that already sets aria-current"
else
  no "should have passed, got: $out"
fi

# ── 4. quiet on a tab list (aria-selected is correct there, not aria-current) ─
# This exact shape fired on evig's AnalyseTabs before the rule excluded it.
d="$SCRATCH/case4"
make_repo "$d" tabs-repo "components/nav/AnalyseTabs.tsx" '
export function AnalyseTabs({ activeTab }) {
  return (
    <nav role="tablist">
      {tabs.map(t => (
        <Link href={t.href} role="tab" aria-selected={activeTab === t.id}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
'
out="$(run_audit "$d")"
if echo "$out" | grep -q "EXIT:0"; then
  ok "does NOT demand aria-current from a tab list using aria-selected"
else
  no "should have passed (tab list is exempt), got: $out"
fi

# ── 5. baseline suppresses a named repo ─────────────────────────────────────
d="$SCRATCH/case5"
make_repo "$d" exempt-repo "components/Nav.tsx" '
export function Nav({ pathname }) {
  return (
    <nav>
      <Link href={x} className={pathname === x ? "active" : ""}>Only</Link>
    </nav>
  );
}
'
bad="$(NAV_CONTRACT_BASELINE=/nonexistent run_audit "$d")"
if echo "$bad" | grep -q "EXIT:1"; then
  ok "fails without a baseline entry (sanity check before testing suppression)"
else
  no "sanity check itself failed, got: $bad"
fi

baseline="$SCRATCH/case5.baseline"
printf 'exempt-repo   # test fixture\n' > "$baseline"
good="$(NAV_CONTRACT_BASELINE="$baseline" run_audit "$d")"
if echo "$good" | grep -q "EXIT:0"; then
  ok "a baseline entry suppresses a named repo"
else
  no "baseline should have suppressed exempt-repo, got: $good"
fi

# ── 6. two directories, one origin remote → counted once ───────────────────
d="$SCRATCH/case6"
make_repo "$d" repo-a "components/Nav.tsx" '
export function Nav({ pathname }) {
  return (
    <nav>
      <Link href={x} className={pathname === x ? "active" : ""}>Only</Link>
    </nav>
  );
}
' "https://github.com/example/same-repo.git"
make_repo "$d" repo-b "components/Nav.tsx" '
export function Nav({ pathname }) {
  return (
    <nav>
      <Link href={x} className={pathname === x ? "active" : ""}>Only</Link>
    </nav>
  );
}
' "https://github.com/example/same-repo.git"
out="$(run_audit "$d")"
# Should report exactly ONE offending repo, not two, despite two directories.
n=$(echo "$out" | grep -cE "^  (repo-a|repo-b) —")
if [ "$n" = "1" ]; then
  ok "two clones of the same origin remote are audited once, not twice"
else
  no "expected exactly 1 finding for the deduped repo, got $n: $out"
fi

echo
echo "$PASS/$((PASS + FAIL)) nav-contract-audit self-tests passed"
[ "$FAIL" -eq 0 ]
