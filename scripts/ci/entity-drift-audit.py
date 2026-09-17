#!/usr/bin/env python3
"""
ENTITY DRIFT AUDIT — sweep the org for docs that restate the entity list.

Reads DEFAULT BRANCHES over the GitHub API, not local checkouts: a working tree
is evidence of one branch at one moment, and half the fleet's worktrees sit on
stale branches. What production teaches an agent is what is on main.

THE BASELINE IS A RATCHET. Existing copies are listed with a reason. The count
may FALL or hold; it may never RISE without that decision being visible in the
same PR that adds the copy.

Usage:
    python3 scripts/ci/entity-drift-audit.py            # sweep and report
    python3 scripts/ci/entity-drift-audit.py --check    # ratchet, exit 1 on a rise

Detection lives in entity_drift.py, and why it is structural rather than a word
count is documented there — the word-counting version's only finding was the
sentence that fixes the problem.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys

from entity_drift import restatements

ORG = os.environ.get("ORG", "bitbaum")
HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.environ.get("BASELINE", os.path.join(HERE, "entity-drift.baseline"))

# What a coding agent actually reads before touching a repo. A restatement in a
# design doc nobody opens is untidy; one here is a wrong instruction.
DOCS = [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    ".claude/CLAUDE.md",
    ".claude/rules/domain-specific.md",
]

# The producer itself. It does not restate the list; it IS the list.
PRODUCER = ("orangecat", "src/config/entity-registry.ts")


def gh(*args: str) -> str | None:
    """`gh` output, or None. Gated on EXIT STATUS: with --jq, a 403 prints its
    error body to stdout, which reads exactly like a value."""
    try:
        r = subprocess.run(
            ["gh", *args], capture_output=True, text=True, timeout=60, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def repos() -> list[str]:
    out = gh("repo", "list", ORG, "--limit", "200", "--json", "name")
    if not out:
        return []
    try:
        return sorted(r["name"] for r in json.loads(out))
    except (ValueError, KeyError):
        return []


def default_branch(repo: str) -> str:
    # REF_OVERRIDE pins a ref for one repo, as `repo=sha`. It exists so this
    # gate can be proven by MUTATION — run it against the commit before the
    # copies were removed and it must fire. A gate that has never fired is
    # indistinguishable from a clean fleet.
    override = os.environ.get("REF_OVERRIDE", "")
    for pair in override.split(","):
        name, _, ref = pair.partition("=")
        if name.strip() == repo and ref.strip():
            return ref.strip()
    return (gh("api", f"repos/{ORG}/{repo}", "--jq", ".default_branch") or "main").strip()


def read_doc(repo: str, path: str, branch: str) -> str | None:
    out = gh("api", f"repos/{ORG}/{repo}/contents/{path}?ref={branch}", "--jq", ".content")
    if not out or not out.strip():
        return None
    try:
        return base64.b64decode(out).decode("utf-8", "replace")
    except (ValueError, UnicodeDecodeError):
        return None


def load_baseline() -> dict[str, str]:
    allowed: dict[str, str] = {}
    if not os.path.exists(BASELINE):
        return allowed
    with open(BASELINE, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            key, _, why = line.partition("#")
            allowed[key.strip()] = why.strip()
    return allowed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if the count rose")
    args = ap.parse_args()

    names = repos()
    if not names:
        # A vacuous pass reads exactly like coverage. Say so, loudly.
        print("SKIPPED: could not list repos for org", ORG, file=sys.stderr)
        return 0 if not args.check else 1

    allowed = load_baseline()
    findings: list[str] = []
    scanned = 0

    for repo in names:
        branch = default_branch(repo)
        for path in DOCS:
            text = read_doc(repo, path, branch)
            if text is None:
                continue
            scanned += 1
            if (repo, path) == PRODUCER:
                continue
            for f in restatements(text):
                key = f"{repo}/{path}"
                findings.append(f"{key}:{f.line}  {f.kind}, {f.lines} type lines")

    print(f"Scanned {scanned} docs across {len(names)} repos in {ORG}.")
    new = [f for f in findings if f.split(":")[0] not in allowed]

    if findings:
        print("\nRestated entity lists:")
        for f in sorted(findings):
            mark = "  " if f.split(":")[0] in allowed else "NEW "
            print(f"  {mark}{f}")
    else:
        print("No doc restates the entity list. The producer is the only copy.")

    if args.check and new:
        print(
            "\nThese docs teach a list that will drift from "
            f"{PRODUCER[0]}/{PRODUCER[1]}.\n"
            "Replace each with a pointer, or add it to "
            f"{os.path.basename(BASELINE)} WITH A REASON in this same PR.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
