#!/usr/bin/env bash
# No `echo … | grep -q` / `printf … | grep -q` in a shell script.
#
# Under `set -o pipefail` that construct can report "not found" for text that
# IS there: grep -q exits at its first match and closes the pipe, the writer
# takes SIGPIPE (141), and pipefail makes the pipeline's status 141 — so the
# `if` takes the else branch on a SUCCESSFUL match.
#
# It is NOT confined to payloads past the ~4 KB pipe buffer, which is what kept
# it alive. Measured 2026-09-24 in loki on a real 1,158-byte output, 3,000 calls:
# 2/3000 false misses for a phrase near the top, 0/3000 via a here-string. Rare
# per call, but a suite makes hundreds of calls — loki's retire-site suite went
# red on exactly those phrases twice in a week and passed every rerun (loki#874
# swept 82 copies there).
#
# Here, 48 copies included auto-merge-sweep.sh (coverage check), the audits,
# and gc-merged-worktrees.sh, whose `in_use` test would read a live session's
# worktree as unused on a false miss (the pushed/clean/MERGED guards still stand,
# so it could not lose work, but it could pull a directory out from under a
# session).
#
# Fix: a here-string is not a pipeline, so there is no writer to signal:
#     grep -q PATTERN <<<"$var"
#
# This file deliberately contains no instance of the banned form outside
# comments and the quoted self-test strings below.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; fail=0
ok() { pass=$((pass + 1)); echo "  ✓ $1"; }
no() { fail=$((fail + 1)); echo "  ✗ $1"; }

# A writer piped into a grep whose flag cluster contains q. Comment lines skip.
RE='^[^#]*\b(echo|printf)\b[^|#]*\|[[:space:]]*grep[[:space:]]+-[A-Za-z]*q'

echo "no-grep-q-in-a-pipe"

# The detector must still fire — a scanner that matches nothing reads exactly
# like a clean tree.
fires() { grep -qE "$RE" <<<"$1"; }
for s in 'if echo "$out" | grep -qi -- "$2"; then' \
         "printf '%s\\n' \"\$taken\" | grep -qx \"\$p\"" \
         'echo "$(cmd)" | grep -q ok || fail'; do
  fires "$s" && ok "detector fires on: $s" || no "detector is blind to: $s"
done
for s in 'grep -q ok <<<"$out"' 'echo "$x" | grep -c ok' '  # echo "$x" | grep -q in a comment'; do
  fires "$s" && no "detector fires on a safe line: $s" || ok "detector ignores: $s"
done

hits="$(grep -rnE "$RE" --include='*.sh' scripts templates 2>/dev/null \
        | grep -v '^scripts/ci/test-no-grep-q-in-a-pipe\.sh:' || true)"
if [ -z "$hits" ]; then
  ok "no writer is piped into grep -q anywhere under scripts/ or templates/"
else
  no "echo/printf | grep -q reports a MISS on a match under pipefail — use grep -q PATTERN <<<\"\$var\":"
  printf '      %s\n' "$hits"
fi

echo "no-grep-q-in-a-pipe: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
