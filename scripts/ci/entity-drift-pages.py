#!/usr/bin/env python3
"""
ENTITY DRIFT, RENDERED — does any PUBLIC PAGE restate the entity list?

The repo audit reads files in git. Everything a person or a crawler actually
sees — the docs site, the marketing pages — is invisible to it, and that is
half of what "keep the docs current" means.

The gap was found with a browser, not a grep: orangecat.ch/docs renders the
whole type list, in <div> cards that no file-level sweep could ever have seen.

## Why the page list is explicit

`loki/scripts/hetzner/apps.conf` is the producer of which hosts exist, and this
could enumerate them. It does not, because a host is not a page: apps.conf
knows `orangecat.ch` and has no idea that `/docs` is where the list lives.
Guessing paths would either miss the page that matters or crawl the whole site
on a schedule for the sake of tidiness.

So the pages are named, each with the reason it is worth watching, and adding
one is a deliberate act. That is the same trade the DOCS list in the repo audit
makes: a short list of what agents and people actually read beats a crawl.
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from entity_drift_html import page_restatements

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.environ.get("PAGES_BASELINE", os.path.join(HERE, "entity-drift-pages.baseline"))

# The producer of the type list, and of what each type is CALLED. Display names
# are never written down here: `ai_assistant` reads as "Companion", `group` as
# "Organization", and a copy of that mapping would rot the next time one moves.
REGISTRY = "repos/bitbaum/orangecat/contents/src/config/entity-registry.ts"

# Pages worth watching, and why. Not a crawl — see the module docstring.
PAGES = [
    ("https://orangecat.ch/docs", "the public documentation; lists the types"),
    ("https://orangecat.ch/ecosystem", "explains the three products to newcomers"),
    ("https://orangecat.ch/how-it-works", "the first page a prospect reads"),
]


def display_names() -> list[str]:
    """Type display names, from the producer. Empty list = could not look."""
    try:
        r = subprocess.run(
            ["gh", "api", REGISTRY, "--jq", ".content"],
            capture_output=True, text=True, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if r.returncode != 0:
        return []
    try:
        source = base64.b64decode(r.stdout).decode("utf-8", "replace")
    except ValueError:
        return []
    return sorted(set(re.findall(r"^    name: '([^']+)',", source, re.M)))


def fetch(url: str, attempts: int = 3) -> str | None:
    """The page, or None after real effort.

    Retried, because a single flaky request must not turn this gate red: an
    unreachable page is reported as UNKNOWN and fails --check, which is the
    right posture for a page that is genuinely gone and the wrong one for a
    dropped connection. Observed once during development, succeeding on the
    next attempt seconds later.
    """
    headers = {"User-Agent": "fleet-entity-drift", "Accept": "text/html"}
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError, ValueError):
            if attempt == attempts - 1:
                return None
            time.sleep(2 * (attempt + 1))
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
            url, _, why = line.partition("#")
            allowed[url.strip()] = why.strip()
    return allowed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 on an unbaselined page")
    args = ap.parse_args()

    names = display_names()
    if not names:
        # Judging a page with no names would report every one of them clean —
        # the exact false negative this module was rewritten to fix. Say so.
        print("SKIPPED: could not read display names from the producer", file=sys.stderr)
        return 1 if args.check else 0

    allowed = load_baseline()
    findings: list[tuple[str, str]] = []
    unreachable: list[str] = []

    for url, _why in PAGES:
        page = fetch(url)
        if page is None:
            unreachable.append(url)
            continue
        for f in page_restatements(page, names):
            findings.append((url, f"{f.kind}, {len(f.names)} types: {', '.join(f.names)}"))

    print(f"Checked {len(PAGES) - len(unreachable)} of {len(PAGES)} pages "
          f"against {len(names)} type names from the producer.")
    if unreachable:
        # An unreachable page is UNKNOWN, never clean.
        print("Could not reach:", ", ".join(unreachable), file=sys.stderr)

    new = [(u, d) for u, d in findings if u not in allowed]
    if findings:
        print("\nPages presenting the entity list:")
        for url, detail in findings:
            print(f"  {'NEW ' if url not in allowed else '    '}{url}  {detail}")
    else:
        print("No page presents the entity list.")

    if args.check and (new or unreachable):
        if new:
            print(
                "\nA page shows the list. If it is GENERATED from the registry that is "
                f"correct — add it to {os.path.basename(BASELINE)} saying so, and where "
                "it derives from. If it was typed by hand, nothing will update it when a "
                "type is added or renamed: derive it instead.",
                file=sys.stderr,
            )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
