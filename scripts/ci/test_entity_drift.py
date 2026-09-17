#!/usr/bin/env python3
"""
Self-test for the entity-drift detector. No network, no checkout.

The fixtures are the REAL text this detector exists because of — the three
copies that lived in orangecat's agent-read docs on 2026-09-17, and the two
false positives that killed the first, word-counting version of it. A detector
proven against invented fixtures proves only that its author can invent
fixtures that suit it.

Run: python3 scripts/ci/test_entity_drift.py
"""

from __future__ import annotations

import sys

from entity_drift import restatements

# ── The three real copies. Each MUST be caught. ───────────────────────────────

COPY_1_UNION = """\
### Supported Entities

**All entities follow same patterns**:

```typescript
type EntityType =
  | 'product' // Physical/digital goods
  | 'service' // Professional services
  | 'project' // Fundraising projects
  | 'cause' // Charitable causes
  | 'event' // Events/meetups
  | 'loan' // Peer-to-peer lending
  | 'asset' // Real estate, assets
  | 'ai_assistant' // AI chatbots
  | 'organization' // Groups/companies
  | 'circle'; // Communities
```
"""

COPY_2_TABLE = """\
### Entity Economic Taxonomy

| Category               | Entities                  | Finance Type               |
| ---------------------- | ------------------------- | -------------------------- |
| Exchange               | `product`, `service`      | Market transaction         |
| Funding (no strings)   | `cause`, `wishlist`       | Donation/gift              |
| Funding (soft strings) | `project`                 | Milestone accountability   |
| Lending                | `loan`                    | Repayment expected         |
| Investing              | `investment`              | Return/equity expected     |
"""

COPY_3_BULLETS = """\
**Supported Entities**:

- `product` - Physical/digital goods (exchange)
- `service` - Professional services (exchange)
- `project` - Fundraising with accountability
- `cause` - Charitable/no-strings funding
- `research` - Decentralized science funding
- `document` - Structured context for the Cat
"""

# ── The two false positives that rejected the word-counting version. ──────────

PROSE_EXPLAINING_THE_FIX = """\
**Do not copy the list into this file.** The block that used to sit here was a
copy, and it had rotted exactly as a copy does: it named `organization`, which
has never been an entity type, and omitted six that are — `document`, `group`,
`investment`, `research`, `wallet`, `wishlist`. An agent reading it was being
told a list that was wrong in both directions.
"""

LEGITIMATE_CODE_EXAMPLE = """\
Search all entities:

```typescript
const results = await searchEntities({
  query: 'coffee',
  entityTypes: ['product', 'service', 'project'],
});
```
"""

POINTER_NOT_A_LIST = """\
### The list lives in one place

`src/config/entity-registry.ts` — `ENTITY_TYPES`, and the `wallet: { holds, why }`
field on every entry, which is the admission test answered per type.
"""

CASES = [
    ("the union copy", COPY_1_UNION, True),
    ("the taxonomy table", COPY_2_TABLE, True),
    ("the bullet list", COPY_3_BULLETS, True),
    ("prose explaining the fix", PROSE_EXPLAINING_THE_FIX, False),
    ("a legitimate code example", LEGITIMATE_CODE_EXAMPLE, False),
    ("a pointer at the producer", POINTER_NOT_A_LIST, False),
]


def main() -> int:
    failures = 0
    for name, text, should_fire in CASES:
        found = restatements(text)
        fired = len(found) > 0
        ok = fired == should_fire
        verb = "caught" if should_fire else "ignored"
        status = "ok  " if ok else "FAIL"
        detail = f" ({found[0].kind}, {found[0].lines} lines)" if found else ""
        print(f"  {status} {verb}: {name}{detail}")
        if not ok:
            failures += 1

    # A run of three bullets is an example, not a list. The threshold is what
    # separates "here are a couple of types" from "here is the list".
    just_under = "- `product` x\n- `service` y\n- `project` z\n"
    if restatements(just_under):
        print("  FAIL three list lines should be under the threshold")
        failures += 1
    else:
        print("  ok   ignored: three list lines, under the threshold")

    print()
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"all {len(CASES) + 1} cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
