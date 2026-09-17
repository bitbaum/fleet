#!/usr/bin/env python3
"""
Self-test for the rendered-page detector. No network, no checkout.

The fixture that matters is the fourth one. The first version of this detector
normalised HTML into markdown and reused the file rules, and it reported every
page CLEAN — a false negative proven by counting: orangecat.ch/docs gave 34
list lines and ZERO the rule counted as naming a type, while the whole list sat
in <span> labels inside <div> cards.

So CARD_GRID below is the real shape of that page, and a detector that does not
fire on it is the detector that shipped broken.

Run: python3 scripts/ci/test_entity_drift_html.py
"""

from __future__ import annotations

import sys

from entity_drift_html import page_restatements

# Display names as the PRODUCER spells them — note that neither matches its
# type id: `ai_assistant` is "Companion", `group` is "Organization".
NAMES = [
    "Asset", "Cause", "Circle", "Companion", "Document", "Event", "Investment",
    "Loan", "Organization", "Product", "Project", "Research", "Service",
    "Wallet", "Wishlist",
]

CARD_GRID = """
<div class="grid">
  <div class="card"><span class="font-medium">Product</span><p>Things you sell</p></div>
  <div class="card"><span class="font-medium">Service</span><p>Time you sell</p></div>
  <div class="card"><span class="font-medium">Project</span><p>Funded with milestones</p></div>
  <div class="card"><span class="font-medium">Companion</span><p>AI beings you create</p></div>
</div>
"""

BULLET_LIST = """
<ul>
  <li>Product — physical or digital goods</li>
  <li>Service — professional services</li>
  <li>Cause — no-strings funding</li>
  <li>Wishlist — gift registries</li>
</ul>
"""

TAXONOMY_TABLE = """
<table><tbody>
  <tr><td>Product</td><td>Market transaction</td></tr>
  <tr><td>Service</td><td>Market transaction</td></tr>
  <tr><td>Cause</td><td>Donation</td></tr>
  <tr><td>Loan</td><td>Repayment expected</td></tr>
</tbody></table>
"""

# ── Must NOT fire ─────────────────────────────────────────────────────────────

MARKETING_PROSE = """
<p>Sell a Product, offer a Service, or raise a Project — whatever fits the work
you already do. Some people run a Cause instead.</p>
"""

REPEATED_ONE_TYPE = """
<ul>
  <li>Product: Handmade candles</li>
  <li>Product: Beeswax wraps</li>
  <li>Product: Soap</li>
  <li>Product: Gift box</li>
</ul>
"""

THREE_ONLY = """
<ul><li>Product — goods</li><li>Service — time</li><li>Cause — support</li></ul>
"""

CASES = [
    ("a card grid of type labels", CARD_GRID, True),
    ("a bullet list of types", BULLET_LIST, True),
    ("a taxonomy table", TAXONOMY_TABLE, True),
    ("marketing prose naming four types", MARKETING_PROSE, False),
    ("four items that are all one type", REPEATED_ONE_TYPE, False),
    ("only three types", THREE_ONLY, False),
]


def main() -> int:
    failures = 0
    for name, page, should_fire in CASES:
        found = page_restatements(page, NAMES)
        fired = len(found) > 0
        ok = fired == should_fire
        detail = f" ({found[0].kind}, {len(found[0].names)} types)" if found else ""
        print(f"  {'ok  ' if ok else 'FAIL'} {'caught' if should_fire else 'ignored'}: {name}{detail}")
        failures += 0 if ok else 1

    # Refusing to judge is not the same as judging clean. Without names every
    # page would read as clean, which is the false negative that rewrote this.
    try:
        page_restatements(CARD_GRID, [])
        print("  FAIL no names should raise, not report clean")
        failures += 1
    except ValueError:
        print("  ok   refuses to judge a page with no names from the producer")

    print()
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"all {len(CASES) + 1} cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
