#!/usr/bin/env bash
#
# origin-proof.sh against a fake `gh` and a fake `ots`, no network.
#
# The proof's value is that it CANNOT be produced for content that did not
# exist, and that the chain cannot be edited afterwards without --check going
# red. So the interesting assertions are the negative ones: a private name never
# reaches the public manifest, an unchanged org produces no new manifest, and a
# manifest edited after stamping fails the check. The fake ots records the
# sha256 it was asked to stamp, which is exactly what the real one does before
# the calendar round-trip.

set -uo pipefail
cd "$(dirname "$0")"
SCRIPT="$PWD/origin-proof.sh"

PASS=0 FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
MAINPID=$$
trap '[ "$$" = "$MAINPID" ] && rm -rf "$TMP"' EXIT

# ── fakes ──────────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin"
# The org: three repos, one private, one fork. HEADs come from $TMP/heads so a
# test can move one.
cat > "$TMP/heads" <<EOF
pubkit	1111111111111111111111111111111111111111
secret-thing	2222222222222222222222222222222222222222
EOF
cat > "$TMP/bin/gh" <<'FAKE'
#!/usr/bin/env bash
case "$1 $2" in
  "repo list")
    if [[ "$*" == *isFork* && "$*" == *defaultBranchRef* ]]; then
      printf 'pubkit\tPUBLIC\tmain\nsecret-thing\tPRIVATE\tmain\n'
    else
      printf 'pubkit\tPUBLIC\nsecret-thing\tPRIVATE\n'
    fi ;;
  "api repos/testorg/pubkit/commits/main")
    printf '%s\t2026-01-01T00:00:00Z\n' "$(awk '$1=="pubkit"{print $2}' "$FAKE_HEADS")" ;;
  "api repos/testorg/secret-thing/commits/main")
    printf '%s\t2026-01-02T00:00:00Z\n' "$(awk '$1=="secret-thing"{print $2}' "$FAKE_HEADS")" ;;
  *) echo "fake gh: unhandled: $*" >&2; exit 99 ;;
esac
FAKE
# `ots stamp F` writes F.ots holding sha256(F); `ots info F.ots` prints it the
# way the real client does; `ots upgrade` marks it anchored.
cat > "$TMP/bin/ots" <<'FAKE'
#!/usr/bin/env bash
while [[ "${1:-}" == -* ]]; do shift; done
case "$1" in
  stamp)   sha256sum "$2" | cut -c1-64 > "$2.ots" ;;
  info)    printf 'File sha256 hash: %s\nTimestamp:\n' "$(head -1 "$2")"
           grep -q anchored "$2" && echo "verify BitcoinBlockHeaderAttestation(900000)"; exit 0 ;;
  upgrade) echo anchored >> "$2"; cp "$2" "$2.bak" ;;
  *) echo "fake ots: unhandled: $*" >&2; exit 99 ;;
esac
FAKE
chmod +x "$TMP/bin/gh" "$TMP/bin/ots"

run() {
  PATH="$TMP/bin:$PATH" FAKE_HEADS="$TMP/heads" ORG=testorg PROOF_DIR="$TMP/proofs" \
    bash "$SCRIPT" "$@" 2>&1
}

# ── first stamp ────────────────────────────────────────────────────────────
echo "first run"
out="$(run --stamp)"; rc=$?
m1="$(ls "$TMP/proofs"/*.json 2>/dev/null | head -1)"
[ $rc -eq 0 ] && [ -n "$m1" ] && [ -s "$m1.ots" ] \
  && ok "writes a manifest and a proof beside it" \
  || no "expected manifest + .ots (rc=$rc): $out"
[ "$(jq -r '.repos | length' "$m1")" = "2" ] && ok "one row per non-fork repo" || no "row count: $(jq '.repos' "$m1")"
jq -e '.repos[] | select(.repo == "testorg/pubkit" and .head == "1111111111111111111111111111111111111111")' "$m1" >/dev/null \
  && ok "public repo appears by name with its HEAD" || no "public row missing"
! grep -rq "secret-thing" "$TMP/proofs" \
  && ok "the private repo's name never reaches the proof directory" || no "private name leaked"
label="$(printf 'testorg/secret-thing' | sha256sum | cut -c1-64)"
jq -e --arg l "$label" '.repos[] | select(.repoSha256 == $l)' "$m1" >/dev/null \
  && ok "private repo appears as sha256(org/name), recomputable by whoever knows the name" || no "private label wrong"
[ "$(jq -r '.previous' "$m1")" = "null" ] && ok "first manifest has no predecessor" || no "first manifest claims a previous"
[ "$(head -1 "$m1.ots")" = "$(sha256sum "$m1" | cut -c1-64)" ] \
  && ok "the proof is over the manifest's final bytes" || no "proof hash != file hash"

# ── nothing moved ──────────────────────────────────────────────────────────
echo "second run, no HEAD moved"
sleep 1
out="$(run --stamp)"
[ "$(ls "$TMP/proofs"/*.json | wc -l)" = "1" ] && grep -q "nothing new to prove" <<<"$out" \
  && ok "an unchanged org produces no new manifest" || no "duplicate manifest or wrong message: $out"

# ── a HEAD moved ───────────────────────────────────────────────────────────
echo "third run, one HEAD moved"
sed -i 's/^pubkit\t.*/pubkit\t3333333333333333333333333333333333333333/' "$TMP/heads"
sleep 1 # filenames are second-resolution
out="$(run --stamp)"
m2="$(ls "$TMP/proofs"/*.json | sort | tail -1)"
[ "$m2" != "$m1" ] && ok "a moved HEAD produces a second manifest" || no "no second manifest: $out"
[ "$(jq -r '.previous.file' "$m2")" = "$(basename "$m1")" ] \
  && [ "$(jq -r '.previous.sha256' "$m2")" = "$(sha256sum "$m1" | cut -c1-64)" ] \
  && ok "the second manifest links to the first by name and sha256" || no "chain link wrong: $(jq '.previous' "$m2")"

# ── check ──────────────────────────────────────────────────────────────────
echo "check"
out="$(run --check)"; rc=$?
[ $rc -eq 0 ] && grep -q "chain intact" <<<"$out" && ok "--check passes on an untouched chain" || no "check failed on clean chain: $out"

out="$(run --upgrade)"
grep -q "anchored in Bitcoin: 2, awaiting a block: 0" <<<"$out" \
  && ok "--upgrade reports attestations and removes .bak files" || no "upgrade tally: $out"
[ -z "$(ls "$TMP/proofs"/*.bak 2>/dev/null)" ] && ok "no .bak litter after upgrade" || no ".bak left behind"

# Tamper with the FIRST manifest after stamping: both its own proof and the
# second manifest's link must go red.
jq '.repos[0].head = "4444444444444444444444444444444444444444"' "$m1" > "$m1.tmp" && mv "$m1.tmp" "$m1"
out="$(run --check)"; rc=$?
[ $rc -ne 0 ] && grep -q "proof is over" <<<"$out" && grep -q "previous link does not match" <<<"$out" \
  && ok "editing a stamped manifest fails its proof AND breaks the next link" || no "tamper not detected (rc=$rc): $out"

rm "$m2.ots"
out="$(run --check)"; rc=$?
[ $rc -ne 0 ] && grep -q "has no .ots proof" <<<"$out" \
  && ok "a manifest without a proof is reported" || no "missing proof not detected: $out"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
