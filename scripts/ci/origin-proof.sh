#!/usr/bin/env bash
#
# origin-proof.sh — third-party proof that the fleet's code existed when we say
# it did.
#
# Git dates prove nothing: author date and commit date are fields the committer
# sets, so a fork with a rewritten history looks exactly as old as the original.
# What proves precedence is a clock we do not control, over a hash of the
# content. This script produces two such records:
#
#   1. An OpenTimestamps proof. Every run writes ONE manifest listing the
#      default-branch HEAD of every repo in the org, then stamps that manifest
#      once — the calendars aggregate it into a Bitcoin transaction within a few
#      hours, and `--upgrade` later fetches the completed attestation. One stamp
#      covers 48 repos; the proof file is a few hundred bytes and is verifiable
#      offline by anyone with a Bitcoin node, forever.
#
#   2. A Software Heritage snapshot request. SWH archives public repos with its
#      own ingestion time and a permanent identifier per commit. It cannot see
#      private repos; those are covered by (1) only.
#
# Each manifest names the previous one and its sha256, so the series is a chain:
# forging an early manifest means forging every later one AND the Bitcoin
# blocks they are anchored in.
#
# Precedence is not authorship. A proof shows the content existed on a date; it
# does not show who wrote it. Precedence plus a continuous public history is
# what forks, communities and courts respect, and this is the precedence half.
#
# The fleet repo is PUBLIC, so a private repo appears in a manifest only as
# sha256("<org>/<name>"): whoever knows the name can recompute the hash and
# verify; nobody else learns the name. The commit sha discloses nothing without
# the objects.
#
# Usage:
#   origin-proof.sh                 stamp (if anything moved) + archive + upgrade
#   origin-proof.sh --stamp         write + stamp a manifest if any HEAD moved
#   origin-proof.sh --upgrade       fetch Bitcoin attestations for pending proofs
#   origin-proof.sh --archive       ask Software Heritage to snapshot every public repo
#   origin-proof.sh --check         every manifest matches its proof and its chain link
#
# Env: ORG (default bitbaum), PROOF_DIR (default proofs/origin), GH_TOKEN,
#      SWH_API (default https://archive.softwareheritage.org/api/1).
# Needs: gh, jq, ots (pipx install opentimestamps-client), curl, sha256sum.

set -euo pipefail

ORG="${ORG:-bitbaum}"
PROOF_DIR="${PROOF_DIR:-proofs/origin}"
SWH_API="${SWH_API:-https://archive.softwareheritage.org/api/1}"

DO_STAMP=0 DO_UPGRADE=0 DO_ARCHIVE=0 DO_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --stamp)   DO_STAMP=1 ;;
    --upgrade) DO_UPGRADE=1 ;;
    --archive) DO_ARCHIVE=1 ;;
    --check)   DO_CHECK=1 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [ $((DO_STAMP + DO_UPGRADE + DO_ARCHIVE + DO_CHECK)) -eq 0 ]; then
  DO_STAMP=1 DO_ARCHIVE=1 DO_UPGRADE=1
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 2; }; }
need jq; need sha256sum
[ $((DO_STAMP + DO_ARCHIVE)) -eq 0 ] || need gh
[ $((DO_STAMP + DO_UPGRADE + DO_CHECK)) -eq 0 ] || need ots
[ "$DO_ARCHIVE" -eq 0 ] || need curl

mkdir -p "$PROOF_DIR"

# ── the org, as seen over the API ──────────────────────────────────────────
#
# Default branches only, read remotely: a local checkout is one branch at one
# moment and may be days stale. Forks are skipped — their HEAD is someone
# else's work and stamping it would claim precedence we do not have. Archived
# repos stay in: an origin claim does not expire when the work stops.
#
# Output: TSV of name, visibility, branch, head sha, committer date.
list_heads() {
  gh repo list "$ORG" --limit 500 \
    --json name,visibility,isFork,defaultBranchRef \
    --jq '.[] | select(.isFork | not) | select(.defaultBranchRef != null)
          | [.name, .visibility, .defaultBranchRef.name] | @tsv' \
  | sort \
  | while IFS=$'\t' read -r name vis branch; do
      # The API can answer 409 for an empty repo; there is nothing to prove there.
      if ! commit="$(gh api "repos/$ORG/$name/commits/$branch" \
                      --jq '[.sha, .commit.committer.date] | @tsv' 2>/dev/null)"; then
        echo "  skip $ORG/$name: no commits on $branch" >&2
        continue
      fi
      printf '%s\t%s\t%s\t%s\n' "$name" "$vis" "$branch" "$commit"
    done
}

# sha256("<org>/<name>") — what a private repo is called in a public manifest.
private_label() { printf '%s/%s' "$ORG" "$1" | sha256sum | cut -c1-64; }

# ── manifest ───────────────────────────────────────────────────────────────
#
# Reads the TSV from list_heads on stdin; writes the manifest JSON to stdout.
# `previous` is the newest existing manifest and its sha256 — the chain link.
build_manifest() {
  local prev_file="${1:-}" prev_sha="" prev_name=null
  if [ -n "$prev_file" ]; then
    prev_sha="$(sha256sum "$prev_file" | cut -c1-64)"
    prev_name="$(basename "$prev_file")"
  fi
  local rows='[]'
  while IFS=$'\t' read -r name vis branch head date; do
    [ -n "$name" ] || continue
    if [ "$vis" = "PRIVATE" ]; then
      rows="$(jq -c --arg l "$(private_label "$name")" --arg b "$branch" --arg h "$head" --arg d "$date" \
        '. + [{repoSha256: $l, branch: $b, head: $h, committedAt: $d}]' <<<"$rows")"
    else
      rows="$(jq -c --arg r "$ORG/$name" --arg b "$branch" --arg h "$head" --arg d "$date" \
        '. + [{repo: $r, branch: $b, head: $h, committedAt: $d}]' <<<"$rows")"
    fi
  done
  jq -n --arg org "$ORG" --arg at "$(date -u +%FT%TZ)" \
        --arg pn "$prev_name" --arg ps "$prev_sha" --argjson rows "$rows" '
    {
      schema: 1,
      org: $org,
      generatedAt: $at,
      previous: (if $ps == "" then null else {file: $pn, sha256: $ps} end),
      repos: $rows,
      _notes: [
        "One row per non-fork repository: its default branch and HEAD commit at generatedAt.",
        "A private repository is named only by repoSha256 = sha256(\"<org>/<name>\").",
        "The .ots file beside this manifest is an OpenTimestamps proof over its sha256; `ots info` shows the hash, `ots verify` needs a Bitcoin node.",
        "previous chains this manifest to the one before it; the series is only as forgeable as the Bitcoin blocks it is anchored in."
      ]
    }'
}

newest_manifest() { { ls -1 "$PROOF_DIR"/*.json 2>/dev/null || true; } | sort | tail -1; }

# Did any HEAD move since the newest manifest? Compares the repo rows only.
heads_changed() {
  local prev="$1" candidate="$2"
  [ -n "$prev" ] || return 0
  ! diff -q <(jq -S '.repos' "$prev") <(jq -S '.repos' "$candidate") >/dev/null
}

stamp() {
  echo "== stamp"
  local heads prev candidate
  heads="$(list_heads)"
  local n; n="$(printf '%s\n' "$heads" | sed '/^$/d' | wc -l)"
  [ "$n" -gt 0 ] || { echo "no repos listed for $ORG — a token problem, not an empty org" >&2; exit 1; }
  prev="$(newest_manifest)"
  candidate="$(mktemp)"
  printf '%s\n' "$heads" | build_manifest "$prev" > "$candidate"
  if ! heads_changed "$prev" "$candidate"; then
    echo "  $n repos, no HEAD moved since $(basename "$prev") — nothing new to prove"
    rm -f "$candidate"
    return 0
  fi
  local out="$PROOF_DIR/$(date -u +%Y-%m-%dT%H%M%SZ).json"
  mv "$candidate" "$out"
  chmod 644 "$out" # mktemp made it 0600; this is a public record
  ots stamp "$out" >/dev/null
  [ -s "$out.ots" ] || { echo "ots stamp produced no proof for $out" >&2; exit 1; }
  echo "  $n repos ($(jq '[.repos[] | select(.repoSha256)] | length' "$out") private) -> $out + .ots"
}

# ── upgrade: pending -> anchored ───────────────────────────────────────────
#
# A fresh stamp holds only calendar promises. Hours later the calendar has put
# the merkle root in a Bitcoin block, and `ots upgrade` replaces the promise
# with the block attestation. Idempotent; prints a tally.
upgrade() {
  echo "== upgrade"
  local anchored=0 pending=0 f
  for f in "$PROOF_DIR"/*.ots; do
    [ -e "$f" ] || continue
    if ! ots info "$f" | grep -q BitcoinBlockHeaderAttestation; then
      ots -q upgrade "$f" >/dev/null 2>&1 || true
      rm -f "$f.bak"
    fi
    if ots info "$f" | grep -q BitcoinBlockHeaderAttestation; then
      anchored=$((anchored + 1))
    else
      pending=$((pending + 1))
    fi
  done
  echo "  anchored in Bitcoin: $anchored, awaiting a block: $pending"
}

# ── Software Heritage ──────────────────────────────────────────────────────
#
# Anonymous save requests are limited to 10 an hour (measured 2026-09-14: the
# 120/h in the response headers is the READ limit; the tenth POST got a 429).
# With 45 public repos an alphabetical walk would request the same nine every
# night and never reach the rest, so the order is shuffled by day: over a
# fortnight every repo is asked for several times. SWH also re-crawls GitHub
# origins on its own; this is a nudge, not the only path in. An SWH_TOKEN
# (a free account) lifts the limit to 1200/h and covers the org in one run.
archive() {
  echo "== archive"
  local accepted=0 refused=0 name vis code
  local -a auth=()
  [ -z "${SWH_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $SWH_TOKEN")
  while IFS=$'\t' read -r name vis; do
    [ -n "$name" ] || continue
    [ "$vis" = "PUBLIC" ] || continue
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${auth[@]}" \
              "$SWH_API/origin/save/git/url/https://github.com/$ORG/$name/" || echo 000)"
    case "$code" in
      200) accepted=$((accepted + 1)) ;;
      429) echo "  rate-limited at $ORG/$name after $accepted; the rest wait for the next run"; break ;;
      *)   refused=$((refused + 1)); echo "  $ORG/$name: HTTP $code" ;;
    esac
  done < <(gh repo list "$ORG" --limit 500 --json name,visibility,isFork \
             --jq '.[] | select(.isFork | not) | [.name, .visibility] | @tsv' \
           | while IFS=$'\t' read -r n v; do
               printf '%s\t%s\t%s\n' "$(printf '%s%s' "$n" "$(date -u +%F)" | sha256sum | cut -c1-16)" "$n" "$v"
             done | sort | cut -f2-)
  echo "  snapshot requested for $accepted public repos ($refused refused)"
}

# ── check: every manifest is what its proof and its predecessor say ────────
check() {
  echo "== check"
  local bad=0 prev="" f actual stamped link
  for f in $({ ls -1 "$PROOF_DIR"/*.json 2>/dev/null || true; } | sort); do
    actual="$(sha256sum "$f" | cut -c1-64)"
    if [ ! -e "$f.ots" ]; then
      echo "  ✗ $f has no .ots proof"; bad=$((bad + 1))
    else
      stamped="$({ ots info "$f.ots" || true; } | sed -n 's/^File sha256 hash: //p' | head -1)"
      [ "$stamped" = "$actual" ] || { echo "  ✗ $f: proof is over $stamped, file is $actual"; bad=$((bad + 1)); }
    fi
    link="$(jq -r '.previous.sha256 // ""' "$f")"
    if [ -n "$prev" ]; then
      [ "$link" = "$(sha256sum "$prev" | cut -c1-64)" ] \
        || { echo "  ✗ $f: previous link does not match $(basename "$prev")"; bad=$((bad + 1)); }
    fi
    prev="$f"
  done
  if [ -z "$prev" ]; then echo "  no manifests in $PROOF_DIR"; return 0; fi
  [ "$bad" -eq 0 ] && echo "  ✓ chain intact, every manifest matches its proof" || { echo "  $bad problem(s)"; return 1; }
}

[ "$DO_STAMP"   -eq 0 ] || stamp
[ "$DO_ARCHIVE" -eq 0 ] || archive
[ "$DO_UPGRADE" -eq 0 ] || upgrade
[ "$DO_CHECK"   -eq 0 ] || check
