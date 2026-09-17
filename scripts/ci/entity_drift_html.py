#!/usr/bin/env python3
"""
The rendered half: a PUBLIC PAGE that restates the entity list.

`entity-drift-audit.py` reads repo files, so every marketing page and doc site
is invisible to it. The gap is not theoretical — orangecat.ch/docs carries the
whole list, which is exactly the shape the repo detector exists to catch.

── WHY THE MARKDOWN RULE CANNOT BE REUSED AS-IS ───────────────────────────────

The first attempt normalised HTML into markdown-ish lines and handed it to
`restatements()`. It reported every page CLEAN, and that was a false negative,
proven by counting: orangecat.ch/docs yielded 34 list lines and ZERO the rule
counted as naming a type, while six display names sat in the raw HTML.

Two reasons, both structural rather than a bug:

  1. The markdown rule requires a type name to be QUOTED, backticked, or inside
     a table cell — that is what separates `'product'` the identifier from
     "product" the ordinary English word. Rendering strips every one of those
     delimiters.
  2. It matches type IDS. A page shows DISPLAY NAMES, and they are not the same
     string: `ai_assistant` reads as "Companion".

So a rendered page needs its own rule, and this is it: a run of list items or
table rows where each one BEGINS with a type's display name. That is the shape
of an entity-list section — a card grid, a definition list, a taxonomy table —
and ordinary marketing prose does not produce it, because prose says "our
services" mid-sentence rather than opening four consecutive items with four
different type names.

── THE NAMES COME FROM THE PRODUCER, NOT FROM HERE ────────────────────────────

Display names are passed in, never hardcoded. A list of them in this file would
be one more copy of the thing this whole audit exists to stop, and it would rot
the first time a type is renamed — which has already happened once, when
`ai_assistant` became "Companion".
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

MIN_ITEMS = 4

_SCRIPTS = re.compile(r"<(script|style|noscript)\b.*?</\1>", re.S | re.I)
_LI = re.compile(r"<li\b[^>]*>(.*?)</li>", re.S | re.I)
_TR = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
# Inline elements that carry a label rather than a sentence.
_LABEL = re.compile(r"<(?:span|h[1-6]|dt|strong|b)\b[^>]*>([^<]{1,40})</(?:span|h[1-6]|dt|strong|b)>", re.I)


@dataclass(frozen=True)
class PageFinding:
    kind: str  # LIST | TABLE
    items: int
    names: tuple[str, ...]


def _text(fragment: str) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", fragment)).split())


def _opens_with_a_name(text: str, names: list[str]) -> str | None:
    """The display name this item STARTS with, if any.

    Starts-with rather than contains, deliberately. "Sell a Product on
    OrangeCat" is a sentence about a product; an item that opens with "Product"
    and then describes it is an entry in a list of types.
    """
    for name in names:
        if re.match(rf"^{re.escape(name)}\b", text, re.I):
            return name
    return None


def _is_exactly_a_name(text: str, names: list[str]) -> str | None:
    """The display name this element's text IS, entire and alone."""
    stripped = text.strip()
    for name in names:
        if stripped.lower() == name.lower():
            return name
    return None


def page_restatements(page: str, display_names: list[str]) -> list[PageFinding]:
    """Structural restatements of the entity list in a rendered page."""
    if not display_names:
        # No names means nothing can be judged. Returning "clean" here would be
        # the same false negative this module was rewritten to fix.
        raise ValueError("display_names is empty — refusing to report a page clean")

    # Longest first, so "AI Assistant" cannot be shadowed by a shorter name.
    names = sorted(display_names, key=len, reverse=True)
    body = _SCRIPTS.sub(" ", page)
    out: list[PageFinding] = []

    for kind, pattern, extract in (
        ("TABLE", _TR, lambda m: " ".join(_text(c) for c in _CELL.findall(m)[:1])),
        ("LIST", _LI, _text),
        # The card grid. orangecat.ch/docs renders its type list as <div>s with
        # a <span> label and a <p> description — no <li>, no <tr>, invisible to
        # both rules above. Measured: 34 list items on that page and not one of
        # them a type, while the whole list sat in spans.
        #
        # The rule that catches it without catching prose: a display name that
        # is the ENTIRE text of a small inline element. "Companion" alone in a
        # span is a label in a list; "a Companion you can sell" is a sentence.
        ("LABELS", _LABEL, _text),
    ):
        hits: list[str] = []
        for frag in pattern.findall(body):
            text = extract(frag)
            name = (
                _is_exactly_a_name(text, names)
                if kind == "LABELS"
                else _opens_with_a_name(text, names)
            )
            if name:
                hits.append(name)
        # DISTINCT names: four cards all opening with "Product" is a product
        # listing, not a restatement of the type list.
        distinct = sorted(set(hits))
        if len(distinct) >= MIN_ITEMS:
            out.append(PageFinding(kind, len(hits), tuple(distinct)))

    return out
