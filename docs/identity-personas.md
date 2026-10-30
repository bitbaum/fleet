# Personas (Morulia) on the shared sign-in

Status: decided 2026-10-30. The owner delegated the call; it is reversible
until lives are built. Nothing in this file is built yet except where it says so.

## What

**Morulia** is where a person grows and manages their *lives*: one root
account, as many personas as they want, each with its own name, handle,
picture, languages and place. The person decides which lives are shown as
linked.

## Where it lives: same engine, different faces

- **Engine:** the shared bitbaum sign-in (`STACK.md`, "Identity
  (2026-10-11)"). Lives hang off the root account that service already holds.
  A separate Morulia account store would give every person two roots — two
  recoveries, two sets of passkeys — so there is none.
- **Faces:** the sign-in service stays invisible plumbing (the "Continue with…"
  button and its redirect). Morulia is what people see: `morulia.com` for
  managing lives, and the consent screen "Sign in to <app> as…".
- Apps keep owning their accounts, as `STACK.md` requires. OrangeCat stays one
  door among several. Morulia adds no further login provider.

## Subjects

The service derives a pairwise subject per app. As implemented in the
service's `lib/subject.ts` (not yet published; the `bitbaum/signin`
repository is pending):

- root: HMAC-SHA256(secret, `<sector>.<userId>`), where `sector` is the host
  of the app's first redirect URI. This is the value the plugin issues today,
  and a test pins it.
- a life: HMAC-SHA256(secret, `<sector>.<userId>|persona|<lifeId>`).
- "root" means no persona, or a persona equal to `userId`. A life id is
  `life_<uuid>` from a lives table; any other non-root persona is refused, so
  a life can never fall back to the root subject.

**Prerequisite for lives:** better-auth's oauth-provider plugin computes `sub`
itself with no hook to replace it. Per-life subjects need an upstream hook or
our own extension point.

## Rules

| Who decides | What | Default |
|---|---|---|
| The person | Lives are shown as linked | On; can be switched off per life |
| The person | Each life's name, place, languages | Free choice |
| The organization (its Solon constitution) | Whether lives may join and vote; one vote per life or per person; whether disclosed links are required | The organization's choice |

- Personas are legitimate by default, from any country or from places that are
  not nation states (a municipality, an area, a network state, a DAO).
- A life never makes claims with legal consequences (tax residency, KYC,
  contracts, payment rails). Those come from the root's legal identity, which
  stays private unless the person shares it.
- A life may pledge voluntary contributions to a place it is affiliated with.
  The place accepts or declines the person through its own Solon constitution.
  The product says once that a pledge does not replace taxes owed. Pledges are
  non-custodial, like every payment in the fleet.

## Open

1. Whether a review, endorsement or backing given by one life to a sibling
   life's project is always marked "same person", even with links switched
   off (EU and Swiss consumer law forbid undisclosed self-reviews).
2. The default persona settings a new Solon organization starts with.
3. Whether "Continue with Morulia" replaces or sits beside the OrangeCat button
   on outside sites.

## Build order

Each step ships on its own.

1. The shared sign-in service, as built.
2. Lives in the service: the "Sign in as…" picker, per-life claims and subjects.
3. `morulia.com`: lives, a life's page, the root.
4. A switcher in every app header, through `@bitbaum/accountkit`.
5. Places and pledges, through Solon.
6. Proofs: show that two lives are one person, or that a life is an adult or a
   resident, without revealing the other lives.
