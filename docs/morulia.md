# Morulia: identity without a master number

Status: direction set by the owner, 2026-10-30 to 2026-11-01. Nothing in this
file is built yet except where it says so.

## What

**Morulia is the fleet's identity system.** It works like a passport office,
with one difference: there is no single identity per being, and no number
that follows anyone around.

- **Anyone or anything can hold identities, as many as it wants.** A person
  can live several full lives, as Pessoa wrote as dozens of complete
  heteronyms. An AI agent can hold identities, and so can a robot, an
  organisation or an animal.
- **Each identity has its own name, face, languages, place and history,** and
  it can act and transact under that name.
- **Every identity has a keeper:** the root that controls it, which is a
  person, an organisation or an agent. The keeper can stay private. An
  identity's *kind* (human, agent, robot, animal, organisation, other) is
  something it declares; Morulia does not verify it, and other parties decide
  what they accept.
- The name comes from the *morula*: one cell dividing into many, all from one
  origin.

## What people see

- **Signing in stays "Sign in with OrangeCat" for now.** No Morulia button
  appears on any app yet.
- **Morulia's own screens are where identities are managed:** create one, give
  it a name and a face, choose which identities are shown as linked, see which
  apps each one has used, switch one off.
- **Underneath, it is all Morulia:** the code, the database and the engine.

## Where it lives: one service

- **Engine:** the shared bitbaum sign-in (`STACK.md`, "Identity"), repo
  `bitbaum/morulia` (renamed from `bitbaum/signin`, whose address GitHub
  redirects), live at `signin.orangecat.ch`. Identities hang off the
  root account that service already holds. There is no second account store,
  because that would give every person two roots: two recoveries and two sets
  of passkeys.
- One repo holds the engine, the management screens and the database,
  because both halves read and write the same records. Its host moves to
  `morulia.orangecat.ch` while no app points at the old one yet.
- Apps keep owning their accounts, as `STACK.md` requires. Morulia adds no
  further login provider.

## Design rule: no master number

What makes a state number a tracking tool is one identifier, the same
everywhere, shared by every system. Morulia never creates one.

1. **A different ID for every identity in every app.** This is built: see
   Subjects. Two apps comparing records cannot tell they hold the same being.
2. **The root never leaves Morulia.** The link between a keeper and its
   identities is not sent to any app, so there is nothing to collect or hand
   over.
3. **Prove a fact, not an identity.** "This identity is an adult", "a human
   stands behind this agent", "these two identities share a keeper": each is
   shown to one party, revealing nothing else (verifiable credentials,
   zero-knowledge proofs).
4. **Keys held by the keeper.** Long term, each identity is backed by keys on
   the keeper's own device, so Morulia itself cannot hand identities to anyone.
   An agent gets its own keys, limited to what its keeper allows.
5. **Collect almost nothing.** No legal name, document scan or phone number is
   required. What is not stored cannot be demanded or leaked.

## Subjects

The service derives a pairwise subject per app. As implemented in the
service's `lib/subject.ts` (`bitbaum/morulia`):

- root: HMAC-SHA256(secret, `<sector>.<userId>`), where `sector` is the host
  of the app's first redirect URI. This is the value the plugin issues today,
  and a test pins it.
- an identity: HMAC-SHA256(secret, `<sector>.<userId>|persona|<lifeId>`).
- "root" means no persona, or a persona equal to `userId`. An identity id is
  `life_<uuid>` from a lives table; any other non-root persona is refused, so
  an identity can never fall back to the root subject.

**Prerequisite for identities:** better-auth's oauth-provider plugin computes
`sub` itself with no hook to replace it. Per-identity subjects need an
upstream hook or our own extension point.

## Rules

| Who decides | What | Default |
|---|---|---|
| The keeper | Identities are shown as linked | On; can be switched off per identity |
| The keeper | Each identity's name, kind, place, languages | Free choice |
| The organisation (its Solon constitution) | Whether identities may join and vote; one vote per identity or per keeper; which kinds it accepts; whether disclosed links are required | The organisation's choice |

- Identities are legitimate by default, from any country or from places that
  are not nation states (a municipality, an area, a network state, a DAO).
- Solon's humans-only decisions (`AID_DISBURSEMENT`, `MEMBERSHIP`, `SAFETY`,
  `GOVERNANCE_RULES`) need an identity that declares a human keeper.
- An identity never makes claims with legal consequences (tax residency, KYC,
  contracts, payment rails). Those come from the keeper's legal identity,
  which stays private unless the keeper shares it.
- An identity may pledge voluntary contributions to a place it is affiliated
  with. The place accepts or declines it through its own Solon constitution.
  The product says once that a pledge does not replace taxes owed. Pledges are
  non-custodial, like every payment in the fleet.
- A review, endorsement or backing that one identity gives to a sibling
  identity's project is always marked "same keeper", even when links are
  switched off. The mark names no other identity. EU and Swiss consumer law
  forbid undisclosed self-reviews, so the links switch cannot turn the mark
  off. Decided 2026-10-31.

## Open

1. The default identity settings a new Solon organisation starts with.
2. Private arbitration in Solon: identities of any kind, an AI included, acting
   as arbiters that the parties choose.
3. When Morulia appears on the sign-in button, if ever.

## Build order

Each step ships on its own.

1. The shared sign-in service: built and running. It signs nobody in until a
   provider (Google, GitHub…) is configured and an app is connected.
2. Identities in the service: the "Sign in as…" picker, per-identity claims and
   subjects.
3. Morulia's screens: identities, an identity's page, the root.
4. A switcher in every app header, through `@bitbaum/accountkit`.
5. Places and pledges, through Solon.
6. Proofs, as in rule 3 above.
7. Keeper-held keys, as in rule 4 above.
