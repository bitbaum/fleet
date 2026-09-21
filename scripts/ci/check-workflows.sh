#!/usr/bin/env bash
# This repo's own workflows must PARSE, and their shell must be SHELL.
#
# WHY THIS EXISTS
#
# CI already validates `templates/ci/*.yml`, on the reasoning that a broken
# template is copied into another repo and fails there, far from here. The
# workflows in this very directory had no such check, and on 2026-09-21
# `internal-currency.yml` merged to main as invalid YAML.
#
# THE FAILURE MODE IS THE POINT. A workflow GitHub cannot parse does not go
# red. It does not warn. It is registered with its FILE PATH where its name
# should be, and it never runs — not on dispatch, not on its schedule. The only
# symptom was `run_workflow` answering "Workflow does not have
# 'workflow_dispatch' trigger" about a file that plainly declares one, because
# GitHub had not managed to read the `on:` block either.
#
# That is the same shape as every other incident in SHARED.md: not a red build,
# but a silence that reads exactly like health.
#
# WHAT BROKE IT, and why `yaml.safe_load` alone would not be enough
#
# A `run: |` block is a YAML block scalar. Every line must stay indented past
# the block's column, and a heredoc written flush-left — the natural way to
# write one — terminates the scalar mid-command:
#
#     run: |
#       git commit -m "title
#
#   Body at column 0 …           <- the block ended here, silently
#
# So this checks both halves, because they fail independently:
#
#   1. every workflow parses as YAML, and `name:` and `on:` survive;
#   2. every `run:` block is valid shell, extracted exactly as the runner
#      would see it. `bash -n` is what catches an unterminated heredoc, a
#      missing `fi`, an unbalanced quote — a file can parse as YAML and still
#      hand the runner something that cannot execute.
#
#   bash scripts/ci/check-workflows.sh [dir]        (default .github/workflows)
set -euo pipefail

dir="${1:-.github/workflows}"

# The two helpers are written out ONCE, at top level. A heredoc inside a
# command substitution — `out="$(python3 - <<'PY' … PY)"` — is not the same
# thing and bash warns "unterminated here-document" while quietly running
# nothing. Found by this script's own self-test, which is the argument for
# having one.
helpers="$(mktemp -d)"
trap 'rm -rf "$helpers"' EXIT

cat >"$helpers/parse.py" <<'PY'
import sys, yaml

path = sys.argv[1]
with open(path) as fh:
    doc = yaml.safe_load(fh)

if not isinstance(doc, dict):
    sys.exit("not a mapping at the top level")
if not doc.get("name"):
    sys.exit("no `name:` — GitHub falls back to the file path, which is the tell")
# PyYAML resolves the bare key `on` to the boolean True (YAML 1.1). Both
# spellings are the same workflow key; checking only one would pass a file
# that has neither.
if "on" not in doc and True not in doc:
    sys.exit("no `on:` — this workflow can never be triggered")
if not doc.get("jobs"):
    sys.exit("no `jobs:`")
PY

cat >"$helpers/extract.py" <<'PY'
import sys, yaml

path, out = sys.argv[1], sys.argv[2]
with open(path) as fh:
    doc = yaml.safe_load(fh)

n = 0
for job in (doc.get("jobs") or {}).values():
    for step in (job.get("steps") or []):
        script = step.get("run")
        if not script:
            continue
        n += 1
        with open(f"{out}/{n}.sh", "w") as fh:
            fh.write(script)
        with open(f"{out}/{n}.name", "w") as fh:
            fh.write(step.get("name", "(unnamed step)"))
PY

checked=0
runs=0
bad=0

for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -e "$f" ] || continue
  checked=$((checked + 1))
  name="${f##*/}"

  if ! out="$(python3 "$helpers/parse.py" "$f" 2>&1)"; then
    echo "✗ $name — $out" >&2
    bad=1
    continue
  fi

  # Extract every `run:` exactly as the runner receives it, and ask bash.
  tmp="$(mktemp -d)"
  if ! python3 "$helpers/extract.py" "$f" "$tmp" 2>/dev/null; then
    echo "✗ $name — could not extract its run blocks" >&2
    bad=1
    rm -rf "$tmp"
    continue
  fi

  for script in "$tmp"/*.sh; do
    [ -e "$script" ] || continue
    runs=$((runs + 1))
    # Non-zero OR any stderr at all. `bash -n` exits 0 on an UNTERMINATED
    # HEREDOC and only warns — "here-document delimited by end-of-file" — which
    # is precisely the defect class this script was written for, so checking
    # the exit code alone would have let the original bug through a second
    # time. A clean script prints nothing, so "any output" is the right bar.
    err="$(bash -n "$script" 2>&1)" && rc=0 || rc=$?
    if [ "$rc" -ne 0 ] || [ -n "$err" ]; then
      step_name="$(cat "${script%.sh}.name")"
      echo "✗ $name — step '$step_name' is not valid shell: ${err#*: }" >&2
      bad=1
    fi
  done
  rm -rf "$tmp"
done

# A checker that swept nothing passes exactly as quietly as one that works.
if [ "$checked" -eq 0 ]; then
  echo "no workflows found in $dir — did they move?" >&2
  exit 1
fi

[ "$bad" -eq 0 ] || exit 1
echo "workflows parse and their shell is shell: ok ($checked workflow(s), $runs run block(s))"
