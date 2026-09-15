#!/usr/bin/env bash
#
# bus-factor-audit.sh against a fake `gh`, no network, no box.
#
# The audit reports on apps nobody is watching, so its own failure mode is
# silence: it must flag a live app whose repo names no env keys, it must NOT
# flag one that does (under any of the accepted file names, at the app_dir),
# it must ignore non-live rows, and the ratchet must go red when the count
# rises and stay quiet when it does not.

set -uo pipefail
cd "$(dirname "$0")"
SCRIPT="$PWD/bus-factor-audit.sh"

PASS=0 FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
MAINPID=$$
trap '[ "$$" = "$MAINPID" ] && rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

# The register: three live apps and a prospect. `named` keeps its keys at the
# app_dir under a non-default name; `bare` has nothing; `rooted` has the
# default name at the repo root.
cat > "$TMP/apps.conf" <<'EOF'
# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
named|4101|named.example|/home/x/dev/named-repo|apps/web|named|bitbaum|product|live|-|-|-
bare|4102|bare.example|/home/x/dev/bare|.|bare|bitbaum|product|live|-|-|-
rooted|4103|rooted.example|/home/x/dev/rooted|.|-|bitbaum|demo|live|-|-|-
future|4104|-|/home/x/dev/future|.|-|bitbaum|product|prospect|-|-|-
EOF
cat > "$TMP/bin/gh" <<FAKE
#!/usr/bin/env bash
case "\$*" in
  *"contents/scripts/hetzner/apps.conf"*) cat "$TMP/apps.conf" ;;
  *"repos/testorg/named-repo/contents/apps/web/.env.local.example"*) echo '"apps/web/.env.local.example"' ;;
  *"repos/testorg/rooted/contents/.env.example"*) echo '"/.env.example"' ;;
  *"/contents/"*) echo "Not Found" >&2; exit 1 ;;
  *) echo "fake gh: unhandled: \$*" >&2; exit 99 ;;
esac
FAKE
chmod +x "$TMP/bin/gh"

run() { PATH="$TMP/bin:$PATH" ORG=testorg BASELINE="$TMP/baseline" bash "$SCRIPT" "$@" 2>&1; }

echo "bus-factor audit"
out="$(run)"; rc=$?
[ $rc -eq 0 ] && ok "reports without --check and exits 0" || no "report exited $rc: $out"
grep -q 'bare .*MISSING' <<<"$out" && ok "a live app whose repo names no keys is flagged" || no "bare not flagged: $out"
grep -q 'named .*yes .*apps/web/.env.local.example' <<<"$out" && ok "keys found at the app_dir under an alternative name count" || no "named not found: $out"
grep -q 'rooted .*yes' <<<"$out" && ok "keys at the repo root count" || no "rooted not found: $out"
! grep -q 'future' <<<"$out" && ok "a prospect is not audited — no operator problem yet" || no "prospect audited"
grep -q 'not named in the repo: 1 (bare)' <<<"$out" && ok "the count names the app" || no "count line wrong: $(grep 'not named' <<<"$out")"

echo "ratchet"
echo 1 > "$TMP/baseline"
out="$(run --check)"; rc=$?
[ $rc -eq 0 ] && grep -q 'ratchet: 1 <= baseline 1' <<<"$out" && ok "at the baseline the ratchet stays quiet" || no "ratchet red at baseline (rc=$rc): $out"
echo 0 > "$TMP/baseline"
out="$(run --check)"; rc=$?
[ $rc -ne 0 ] && grep -q 'RATCHET: 1 live apps' <<<"$out" && ok "above the baseline the ratchet goes red" || no "ratchet not red (rc=$rc): $out"
out="$(run --emit-baseline)"; [ "$(cat "$TMP/baseline")" = "1" ] && ok "--emit-baseline writes the current count" || no "emit wrote $(cat "$TMP/baseline")"

echo "an empty register is an error, not a clean sweep"
: > "$TMP/apps.conf"
out="$(run)"; rc=$?
[ $rc -eq 2 ] && grep -q 'not an empty fleet' <<<"$out" && ok "zero live rows exits 2 with a token/path warning" || no "empty register passed (rc=$rc)"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
