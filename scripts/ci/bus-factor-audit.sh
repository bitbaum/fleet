#!/usr/bin/env bash
#
# Fleet audit: could someone who is not Cato operate each live app tomorrow?
#
# "Ready for takeoff in whatever form" means the fleet keeps running when its
# one operator is not there. loki's check-deploy-ready.sh already proves each
# app has CI and a Deploy that reaches the box, and the watchdog proves each
# URL answers. What nothing checked is the part that needs a HUMAN who knows
# things:
#
#   env-example   Every live app reads secrets from a box .env that only the
#                 box has. If the repo does not name those keys in a committed
#                 .env.example, an operator cannot rotate a leaked key or
#                 rebuild the box without reverse-engineering the code. The
#                 names are not secrets; the absence of the names is the
#                 bus factor. Read from each repo's REMOTE default branch,
#                 ratcheted: the count of live apps without one may fall,
#                 never rise.
#
#   --box         Two facts only the box knows, checked over ssh (local runs
#                 and dispatch only — no fleet workflow holds a box key):
#                 rollback     /opt/<app>/app is a release symlink, so
#                              rollback.sh can flip it. An app deployed by
#                              hand into a plain directory has no way back.
#                 backup       the app's database has a dump in
#                              /opt/backups/pg younger than BACKUP_MAX_HOURS
#                              (36). A backup timer that stopped is silent;
#                              the dump's mtime is not.
#                 off-box      /opt/backups/restic.env exists, i.e. dumps
#                              leave the disk they protect. One fact for the
#                              whole box, reported, not ratcheted — it is a
#                              decision (a Storage Box), not a drift.
#
# Not checked, and said so: whether a restore has ever been EXERCISED. That
# is a drill, not an audit; the audit only tells you the drill is possible.
#
# The app list is loki's scripts/hetzner/apps.conf on its default branch —
# the one register provisioning reads — never a local checkout.
#
# Usage:
#   bus-factor-audit.sh            report
#   bus-factor-audit.sh --check    exit 1 if the env-example count rose above the baseline
#   bus-factor-audit.sh --box      add the ssh checks (needs BOX or HETZNER_IP)
#   bus-factor-audit.sh --emit-baseline   write the current count to the baseline file
#
# Env: ORG (bitbaum), APPS_CONF_REPO (bitbaum/loki), APPS_CONF_PATH,
#      BOX or HETZNER_IP (no default), BACKUP_MAX_HOURS (36), BASELINE (path).

set -uo pipefail

ORG="${ORG:-bitbaum}"
APPS_CONF_REPO="${APPS_CONF_REPO:-bitbaum/loki}"
APPS_CONF_PATH="${APPS_CONF_PATH:-scripts/hetzner/apps.conf}"
# The box address has ONE home: loki scripts/hetzner/_box-env.sh. In Actions the
# value arrives as the org variable HETZNER_IP; locally, source that file if the
# checkout is there. Either way this file does not keep a copy of the number.
_box_env="${DEV_ROOT:-$HOME/dev}/loki/scripts/hetzner/_box-env.sh"
# shellcheck source=/dev/null
[ -f "$_box_env" ] && . "$_box_env"
BOX="${BOX:-${BOX_UBUNTU:-${HETZNER_IP:+ubuntu@${HETZNER_IP}}}}"
BACKUP_MAX_HOURS="${BACKUP_MAX_HOURS:-36}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BASELINE="${BASELINE:-$HERE/bus-factor.baseline}"

CHECK=0 DO_BOX=0 EMIT=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --box) DO_BOX=1 ;;
    --emit-baseline) EMIT=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

# ── the register ───────────────────────────────────────────────────────────
#
# Rows: name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
# Only live rows: a prospect has no operator problem yet.
live_rows() {
  gh api -H "Accept: application/vnd.github.raw" "repos/${APPS_CONF_REPO}/contents/${APPS_CONF_PATH}" \
    | command grep -v '^\s*#' | command grep -v '^\s*$' \
    | awk -F'|' '$9 == "live" { print $1 "|" $4 "|" $5 "|" $6 }'
}

# Candidate names, in the order the fleet actually uses them.
ENV_EXAMPLES=".env.example .env.local.example .env.selfhost.example .env.sample"

# Does the repo's default branch name its env keys at app_dir? Prints the
# file found, or nothing.
env_example_of() { # <repo> <app_dir>
  local repo="$1" dir="$2" f path
  for f in $ENV_EXAMPLES; do
    path="${dir:+$dir/}$f"
    if gh api "repos/${ORG}/${repo}/contents/${path}" --jq .path >/dev/null 2>&1; then
      echo "$path"; return 0
    fi
  done
  return 1
}

rows="$(live_rows)"
n_live="$(printf '%s\n' "$rows" | sed '/^$/d' | wc -l)"
if [ "$n_live" -eq 0 ]; then
  echo "no live rows read from ${APPS_CONF_REPO}:${APPS_CONF_PATH} — a token or path problem, not an empty fleet" >&2
  exit 2
fi

echo "bus-factor audit — ${n_live} live apps in ${APPS_CONF_REPO}:${APPS_CONF_PATH}"
echo
printf '  %-22s %-12s %s\n' "app" "env-example" "where"
missing=0
missing_names=""
while IFS='|' read -r name repo_path app_dir db; do
  [ -n "$name" ] || continue
  repo="$(basename "$repo_path")"
  dir="$app_dir"; [ "$dir" = "." ] && dir=""
  if found="$(env_example_of "$repo" "$dir")"; then
    printf '  %-22s %-12s %s\n' "$name" "yes" "${ORG}/${repo}:${found}"
  else
    printf '  %-22s %-12s %s\n' "$name" "MISSING" "${ORG}/${repo}${dir:+/$dir} names none of: ${ENV_EXAMPLES}"
    missing=$((missing + 1)); missing_names="${missing_names} ${name}"
  fi
done <<<"$rows"
echo
echo "live apps whose secrets are not named in the repo: ${missing}${missing_names:+ (${missing_names# })}"

# ── the box half ───────────────────────────────────────────────────────────
box_failures=0
if [ "$DO_BOX" -eq 1 ]; then
  # Only --box needs an address, so only --box requires one. There is no
  # literal default: the box address lives once, in loki
  # scripts/hetzner/_box-env.sh (sourced above when that checkout is present)
  # and as the org Actions variable HETZNER_IP.
  if [ -z "$BOX" ]; then
    echo "bus-factor --box: no box address. Set BOX or HETZNER_IP, or run where" >&2
    echo "  \${DEV_ROOT:-\$HOME/dev}/loki/scripts/hetzner/_box-env.sh exists." >&2
    exit 1
  fi
  echo
  echo "box (${BOX})"
  # One ssh round-trip: the release symlink per app, the newest dump per db,
  # and whether dumps leave the disk.
  remote_script='
    for name in '"$(printf '%s\n' "$rows" | cut -d'|' -f1 | tr '\n' ' ')"'; do
      if [ -L "/opt/$name/app" ]; then echo "rollback $name yes $(readlink /opt/$name/app | xargs basename)";
      elif [ -d "/opt/$name/app" ]; then echo "rollback $name NO plain-directory";
      else echo "rollback $name NO absent"; fi
    done
    for db in '"$(printf '%s\n' "$rows" | cut -d'|' -f4 | command grep -v '^-$' | command grep -v '^supabase:' | sort -u | tr '\n' ' ')"'; do
      newest=$(ls -1t /opt/backups/pg/*"$db"* 2>/dev/null | head -1)
      if [ -n "$newest" ]; then
        age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
        echo "backup $db ${age_h}h $(basename "$newest")"
      else echo "backup $db none -"; fi
    done
    [ -e /opt/backups/restic.env ] && echo "offbox yes" || echo "offbox NO"
    systemctl is-active pg-backup.timer 2>/dev/null | sed "s/^/timer /"
  '
  if ! out="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$BOX" "$remote_script" 2>&1)"; then
    echo "  ssh to ${BOX} failed: ${out}" >&2
    box_failures=$((box_failures + 1))
  else
    printf '%s\n' "$out" | while read -r kind subject value rest; do
      case "$kind" in
        rollback) [ "$value" = "yes" ] && printf '  rollback  %-22s yes (%s)\n' "$subject" "$rest" \
                                       || printf '  rollback  %-22s NO — %s\n' "$subject" "$rest" ;;
        backup)   if [ "$value" = "none" ]; then printf '  backup    %-22s NONE\n' "$subject";
                  elif [ "${value%h}" -gt "$BACKUP_MAX_HOURS" ]; then printf '  backup    %-22s STALE %s (%s)\n' "$subject" "$value" "$rest";
                  else printf '  backup    %-22s %s (%s)\n' "$subject" "$value" "$rest"; fi ;;
        offbox)   [ "$subject" = "yes" ] && echo "  off-box   dumps leave the disk (restic.env present)" \
                                         || echo "  off-box   NO — dumps live on the disk they protect (drop /opt/backups/restic.env: install-backups.sh phase 2)" ;;
        timer)    echo "  timer     pg-backup.timer ${subject}" ;;
      esac
    done
    box_failures=$(printf '%s\n' "$out" | awk -v max="$BACKUP_MAX_HOURS" '
      $1=="rollback" && $3!="yes" {f++}
      $1=="backup" && ($3=="none" || substr($3,1,length($3)-1)+0 > max) {f++}
      END {print f+0}')
  fi
fi

# ── ratchet ────────────────────────────────────────────────────────────────
if [ "$EMIT" -eq 1 ]; then
  echo "$missing" > "$BASELINE"
  echo "baseline written: $missing -> $BASELINE"
fi
if [ "$CHECK" -eq 1 ]; then
  base="$(cat "$BASELINE" 2>/dev/null || echo 0)"
  if [ "$missing" -gt "$base" ]; then
    echo
    echo "RATCHET: ${missing} live apps without a committed env example, baseline ${base} — a new one shipped without naming its keys" >&2
    exit 1
  fi
  echo "ratchet: ${missing} <= baseline ${base}"
fi
[ "$box_failures" -eq 0 ] || { echo "box: ${box_failures} app(s) cannot be rolled back or restored" >&2; exit 1; }
