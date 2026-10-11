#!/usr/bin/env bash
#
# Render templates/app — the one starter every new bitbaum product is created
# from — into a directory, with its placeholders filled in.
#
#   scripts/templates/render-app.sh <slug> <dest> [--title "Name"] [--host h] [--owner o]
#
# Placeholders (the same four Loki's new-site.sh substitutes):
#   __SLUG__            repo + package name, DNS label  (a-z0-9-, required)
#   __TITLE__           display name                    (default: the slug)
#   __HOST__            public host                     (default: <slug>.orangecat.ch)
#   __WORKFLOW_OWNER__  GitHub owner of the repo/loki   (default: bitbaum)
#
# `gitignore` is shipped without its dot (a file named .gitignore inside a
# template would ignore the template's own files) and renamed here.
#
# A title is substituted into TypeScript string literals and Markdown, so the
# characters that could end a literal or open markup are refused rather than
# escaped per file type: a renderer that knows nothing about the files it fills
# cannot escape correctly for all of them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TEMPLATE="$HERE/../../templates/app"

SLUG="${1:-}"; DEST="${2:-}"
[ -n "$SLUG" ] && [ -n "$DEST" ] || { sed -n '2,20p' "$0" >&2; exit 2; }
shift 2
TITLE="$SLUG"; HOST=""; OWNER="bitbaum"
while [ $# -gt 0 ]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --host)  HOST="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HOST="${HOST:-$SLUG.orangecat.ch}"

[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || { echo "slug must be lowercase letters, digits and hyphens" >&2; exit 2; }
[[ "$HOST" =~ ^[a-z0-9.-]+$ ]] || { echo "host must be a plain hostname" >&2; exit 2; }
[[ "$OWNER" =~ ^[A-Za-z0-9-]+$ ]] || { echo "owner must be a GitHub login" >&2; exit 2; }
case "$TITLE" in
  *'"'*|*"\\"*|*'`'*|*'$'*|*'<'*|*'>'*|*'|'*|*'&'*)
    echo "title may not contain \" \\ \` \$ < > | &" >&2; exit 2 ;;
esac
[ -n "$TITLE" ] || { echo "title is empty" >&2; exit 2; }

[ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && { echo "$DEST is not empty" >&2; exit 1; }
mkdir -p "$DEST"

# Copy what git tracks (or the tree, outside a checkout), never build output.
( cd "$TEMPLATE" && tar --exclude=node_modules --exclude=.next --exclude='*.tsbuildinfo' \
    --exclude=next-env.d.ts -cf - . ) | ( cd "$DEST" && tar -xf - )
mv "$DEST/gitignore" "$DEST/.gitignore"

esc() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
grep -rlZ --exclude-dir=node_modules -e '__SLUG__' -e '__TITLE__' -e '__HOST__' -e '__WORKFLOW_OWNER__' "$DEST" \
  | xargs -0 -r sed -i \
      -e "s|__SLUG__|$(esc "$SLUG")|g" \
      -e "s|__TITLE__|$(esc "$TITLE")|g" \
      -e "s|__HOST__|$(esc "$HOST")|g" \
      -e "s|__WORKFLOW_OWNER__|$(esc "$OWNER")|g"

if left=$(grep -rln --exclude-dir=node_modules -e '__SLUG__' -e '__TITLE__' -e '__HOST__' -e '__WORKFLOW_OWNER__' "$DEST"); then
  echo "placeholders left unfilled in: $left" >&2; exit 1
fi
echo "rendered templates/app as $SLUG into $DEST"
