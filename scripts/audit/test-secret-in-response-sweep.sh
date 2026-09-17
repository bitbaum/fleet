#!/usr/bin/env bash
# Prove the SWEEP's aggregation, which is a different question from whether the
# detector works. test-secret-in-response.py already pins the detector in both
# directions (9 cases). What was never covered, because the sweep did not exist:
#
#   - does a finding on ONE app reach exit 1, or get averaged away
#   - is a host we could not reach WITHHELD, or silently counted clean
#   - does an unreadable register refuse to report a clean sweep over nothing
#
# The third is the one this repo has shipped wrong before, twice: an empty
# result from a failed fetch read as a fact. `gh` and the scanner are both
# stubbed so every path runs with no network.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWEEP="$HERE/secret-in-response-sweep.sh"
pass=0; fail=0
ok()  { printf '  ✓ %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  ✗ %s\n' "$1"; fail=$((fail + 1)); }

# A minimal apps.conf: two live apps, one prospect (must be skipped), one live
# app with no domain (must be skipped), base64'd the way the contents API sends.
mkconf() {
  printf '%s\n' \
    '# comment line' \
    'alpha|3001|alpha.example|r|d|db|bitbaum|product|live|-|-|-' \
    'beta|3002|beta.example|r|d|db|bitbaum|product|live|-|-|-' \
    'ghost|3003|ghost.example|r|d|db|bitbaum|product|prospect|-|-|-' \
    'nodomain|3004|-|r|d|db|bitbaum|product|live|-|-|-' \
  | base64 -w0
}

new_case() {
  local d; d=$(mktemp -d); mkdir -p "$d/bin"
  cat > "$d/bin/gh" <<STUB
#!/usr/bin/env bash
if [ -f "\$GH_SPEC/CONF_FAIL" ]; then echo "gh: HTTP 502" >&2; exit 1; fi
printf '%s' "\$(cat "\$GH_SPEC/CONF")"
STUB
  chmod +x "$d/bin/gh"
  mkdir -p "$d/spec"
  mkconf > "$d/spec/CONF"
  printf '%s' "$d"
}

# A stub "scanner": writes the JSON named by --json-out, exits per its own name.
mkscanner() { # $1=dir  $2=behaviour
  cat > "$1/scanner" <<STUB
#!/usr/bin/env bash
out=""; base=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    --json-out) out="\$2"; shift 2 ;;
    --base) base="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$2" in
  clean)  printf '[]' > "\$out"; exit 0 ;;
  leak)
    case "\$base" in
      *alpha*) printf '[{"severity":"HIGH","path":"/api/me","key":"passwordHash"}]' > "\$out"; exit 1 ;;
      *)       printf '[]' > "\$out"; exit 0 ;;
    esac ;;
  unreachable) exit 7 ;;                 # neither 0 nor 1: could not look
  nowrite) exit 0 ;;                     # exits clean but writes nothing
esac
STUB
  chmod +x "$1/scanner"
}

run() { # $1=dir
  ( cd "$1" && PATH="$1/bin:$PATH" GH_SPEC="$1/spec" \
      SCANNER="$1/scanner" SCANNER_CMD=bash bash "$SWEEP" 2>&1 )
}

echo "secret-in-response sweep — aggregation"

d=$(new_case); mkscanner "$d" clean
out=$(run "$d"); rc=$?
[ $rc -eq 0 ] && ok 'all clean -> exit 0' || bad "clean sweep failed (exit $rc): $out"
grep -q 'scanned 2/2' <<<"$out" && ok 'only LIVE apps with a domain are scanned' \
  || bad "wrong app selection: $(grep -o 'scanned .*' <<<"$out")"
grep -q 'ghost' <<<"$out" && bad 'a prospect was scanned' || ok 'a prospect is not scanned'
grep -q 'nodomain' <<<"$out" && bad 'an app with no domain was scanned' || ok 'an app with no domain is skipped'

d=$(new_case); mkscanner "$d" leak
out=$(run "$d"); rc=$?
[ $rc -eq 1 ] && ok 'a finding on ONE app fails the whole sweep' || bad "a leak did not fail the sweep (exit $rc)"
grep -q 'passwordHash' <<<"$out" && ok 'names the leaking key' || bad 'finding not described'
grep -q '1 finding' <<<"$out" && ok 'counts it' || bad "bad count: $(grep -o '[0-9]* finding.*' <<<"$out")"

d=$(new_case); mkscanner "$d" unreachable
out=$(run "$d"); rc=$?
grep -q 'UNREACHABLE' <<<"$out" && ok 'a host that could not be scanned is withheld out loud' \
  || bad 'an unscannable host was swallowed'
grep -q 'scanned 0/2' <<<"$out" && ok 'it is NOT counted as scanned' || bad 'unreachable counted as scanned'
grep -q 'nothing credential-shaped' <<<"$out" && bad 'claimed a clean fleet having scanned nothing' \
  || ok 'does not claim a clean fleet having scanned nothing'

d=$(new_case); mkscanner "$d" nowrite
out=$(run "$d"); rc=$?
grep -q 'UNREACHABLE' <<<"$out" && ok 'a scanner that writes no result is withheld, not clean' \
  || bad 'a missing result file read as clean'

# THE ONE THIS REPO HAS SHIPPED WRONG BEFORE: a failed register read.
d=$(new_case); mkscanner "$d" clean; touch "$d/spec/CONF_FAIL"
out=$(run "$d"); rc=$?
[ $rc -eq 2 ] && ok 'an unreadable register exits 2, not 0' || bad "unreadable register exited $rc"
grep -q 'refusing to report a clean sweep' <<<"$out" && ok 'and says why' || bad 'no refusal message'

echo
echo "sweep aggregation: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
exit 0
