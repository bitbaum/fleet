#!/usr/bin/env python3
"""
ENTITY DRIFT — does any doc RESTATE the entity list instead of pointing at it?

An entity is anything that can hold a wallet and is better for holding one.
The list of types has one producer, `orangecat/src/config/entity-registry.ts`.
Every copy of that list elsewhere is a copy, and copies rot: measured
2026-09-17, THREE lived in orangecat's own agent-read docs and all three
disagreed. One named `organization`, which has never been a type; another
omitted six that are. These are the files coding agents read before they touch
anything, so each copy was actively teaching a wrong list.

── WHY THIS IS STRUCTURAL AND NOT A WORD COUNT ────────────────────────────────

The obvious detector — "a doc naming 4+ type names is restating the list" — was
written, run against the whole org, and REJECTED, because its only hit was a
false positive on the sentence that FIXES the problem:

    ... named `organization`, which has never been an entity type, and omitted
    six that are — `document`, `group`, `investment`, `research`, `wallet`,
    `wishlist`.

A detector whose first finding is its own remedy is worse than no detector: it
trains people to ignore it. The second false positive was a legitimate code
example, `entityTypes: ['product', 'service', 'project']`.

So a restatement is the list PRESENTED AS THE LIST — a shape, not a vocabulary:

  FENCE  inside a fenced code block, 4+ lines that each name a type, one per
         line. That is the `type EntityType = | 'product' | 'service'` shape.
  LIST   4+ CONSECUTIVE markdown list or table lines that each name a type.
         That is the bullet list and the taxonomy table.

Prose is never counted, however many names it contains, because prose that
names types is almost always explaining them rather than defining them. A
single line holding several names counts once — an inline array is an example,
not a list.

Both false positives above are excluded by construction, and all three real
copies are caught. `test_entity_drift.py` pins that with the actual historical
text, no network and no checkout.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# The types, as the producer defines them. Kept here rather than fetched so the
# self-test needs no network; `--check-producer` verifies the two agree.
ENTITY_TYPES = (
    "wallet project product service cause ai_assistant group circle asset "
    "loan investment event research wishlist document"
).split()

# A type NAMED as an identifier: quoted, backticked, or a table cell. Bare
# English words are not enough — "the project" and "a service" are ordinary
# nouns, and counting them is how a docs gate starts crying wolf.
_NAMED = re.compile(
    r"""(?:['"`|]\s*)(%s)(?:\s*['"`|,])""" % "|".join(ENTITY_TYPES)
)
_LIST_LINE = re.compile(r"^\s*(?:[-*+]\s|\|)")
_FENCE = re.compile(r"^\s*```")

MIN_LINES = 4


@dataclass(frozen=True)
class Finding:
    kind: str  # FENCE | LIST
    line: int  # 1-indexed line where the run starts
    lines: int  # how many type-naming lines the run held


def _names_a_type(line: str) -> bool:
    return bool(_NAMED.search(line))


def restatements(text: str) -> list[Finding]:
    """Every place `text` presents the entity list as a list."""
    out: list[Finding] = []
    lines = text.split("\n")

    in_fence = False
    fence_hits: list[int] = []
    run: list[int] = []

    def close_fence() -> None:
        if len(fence_hits) >= MIN_LINES:
            out.append(Finding("FENCE", fence_hits[0] + 1, len(fence_hits)))
        fence_hits.clear()

    def close_run() -> None:
        if len(run) >= MIN_LINES:
            out.append(Finding("LIST", run[0] + 1, len(run)))
        run.clear()

    for i, line in enumerate(lines):
        if _FENCE.match(line):
            if in_fence:
                close_fence()
            else:
                close_run()
            in_fence = not in_fence
            continue

        if in_fence:
            if _names_a_type(line):
                fence_hits.append(i)
            continue

        # Outside a fence only list and table rows can restate. Prose cannot,
        # which is the whole correction that makes this usable.
        if _LIST_LINE.match(line) and _names_a_type(line):
            run.append(i)
        elif line.strip():
            close_run()

    if in_fence:
        close_fence()
    close_run()
    return out
