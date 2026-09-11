#!/usr/bin/env bash
# Prove ci_can_strand_a_commit fires on the shape that stranded commits, and
# stays quiet on the three shapes that are fine. A rule nobody has seen fail is
# a comment.
set -uo pipefail
cd /home/g/dev/fleet
# shellcheck disable=SC1091
source <(sed -n '/^ci_can_strand_a_commit()/,/^}/p' scripts/ci/cicd-hygiene-audit.sh)

T=$(mktemp -d)
cat > "$T/bad.yml" <<'Y'
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
Y
cat > "$T/fixed.yml" <<'Y'
concurrency:
  group: ci-${{ github.ref }}-${{ github.ref == 'refs/heads/main' && github.sha || 'branch' }}
  cancel-in-progress: true
Y
cat > "$T/nocancel.yml" <<'Y'
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: false
Y
cat > "$T/none.yml" <<'Y'
jobs:
  verify:
    runs-on: ubuntu-latest
Y
# A comment must not EXCUSE a broken group. This file's comment names
# github.sha while the group does not use it, so it must still flag — the
# comment is stripped before matching for exactly this reason.
cat > "$T/prose.yml" <<'Y'
# we should probably key this by github.sha one day
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
Y

for f in bad fixed nocancel none prose; do
  if ci_can_strand_a_commit "$T/$f.yml"; then r="FLAGS"; else r="quiet"; fi
  printf '%-9s %s\n' "$f" "$r"
done
rm -rf "$T"
