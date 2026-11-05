# Shared content foundation: OrangeCat, BiasLens, Heidi, and Loki

Status: implementation underway. Read the [verified continuation checkpoint](#verified-checkpoint--continuation-on-2026-11-05) first for completed stages, release evidence and the remaining queue. The research and original migration order below describe the starting decision.

Follow each product's handoff and linked pull requests for implementation evidence. Previous bounded repairs were OrangeCat [#1562](https://github.com/bitbaum/orangecat/pull/1562) and Loki [#1588](https://github.com/bitbaum/loki/pull/1588); their wider audits remain open. A local branch or scratch patch alone is not a remote backup: preserve verified source on its pushed branch and record the exact unfinished state before changing agents.

## Decision

Extract a small writing foundation before implementing the same authoring lifecycle in a second app. Keep the products separate. Share document editing mechanics, not a combined publishing and truth-analysis product.

Heidi adds a third concrete consumer: adapting source articles for language learning. Its inspected main (`91f4303`) already models a target variety and bridge languages in `lib/variety/pack.ts`, with Zurich German and Ukrainian packs. French is on its roadmap. Its current dialect reader explains received text; it is not a general article adaptation studio. Preserve this existing pack boundary rather than adding Swiss German assumptions to a shared editor.

Treat an adaptation as a new version derived from a source, with a purpose and host-supplied validation. Language/variety, bridge language and requested difficulty are distinct inputs. A French interface does not imply a French learning target; Zurich German is more precise than a generic Swiss German label. Heidi owns its dialect rules, spelling convention and learner guidance. Do not turn its variety checks into a claim that meaning or factual equivalence has been independently verified.

Use existing packages where they already fit: ai-kit for model execution and supported extraction, chatkit for conversation, bip-kit for reading/rendering, and design tokens for appearance. A long-form authoring lifecycle is a separate responsibility. Confirm exact package exports before creating any new API.

## Evidence

- OrangeCat's article page has one editor but separate generation and editing request owners. A generation success notice can survive a draft switch, and an outstanding response can overwrite newer writing. Draft recovery and assistance push the actual editor far down the mobile page.
- BiasLens `src/app/_components/rewrite/RewriteStudio.tsx` provides source-backed rewrite/response operations, voices and comparison. Its request state is local to the studio.
- BiasLens `src/lib/rewrite/run.ts` attaches simulation labels and a model-generated fact comparison. These are domain policies, not generic editor behavior or independent verification.
- BiasLens `src/lib/investigations/revise.ts` generates an initial evidence-led explainer or a subsequent version. Versions retain citations, changes, model/prompt provenance and review flags.
- BiasLens `src/lib/investigations/store.ts` and its revise route enforce edit capabilities and optimistic revision checks. Browser cancellation must not replace those checks.
- BiasLens `docs/plans/2026-11-one-loop.md` already identifies duplicate Examine/Investigate/Rewrite/notebook entry points and proposes one article workspace.
- A general blank-article editor was not found in the inspected BiasLens main branch. Evidence-led initial generation exists; writing freely from scratch is a requirement to support rather than a reason to assume an existing editor can simply be reused.

## Ownership

| Shared foundation                                                | OrangeCat                                    | BiasLens                                                       |
| ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Document identity, revisions, selection                          | Personal writing context and Cat integration | Immutable examined source and source identity                  |
| One active AI operation, cancellation and stale-result rejection | Account-owned drafts and recovery            | Claims, evidence, gaps and investigations                      |
| Proposed edits, explicit application, safe Undo                  | Feed, audience and publishing                | Labelled perspective/outlet simulations                        |
| Text comparison and optional revision presentation               | Cover and summary publishing UI              | Citation checks and model-based fact comparison                |
| Accessible editing controls and host-supplied actions            | Existing auth, storage and API adapters      | Existing capability tokens, server revision checks and storage |

Heidi owns learner progress, glosses, target/bridge variety packs, comprehension exercises and checks of generated language. The shared foundation preserves source references, versions and optional segment alignment without knowing a Swiss word. Segment alignment is optional and must not pretend that every translated sentence maps one-to-one to an original.

Do not move model providers, HTTP endpoints, credentials, quotas, publishing or account storage into the writing foundation. Hosts supply asynchronous operations against a captured document revision and receive proposed changes. A result can apply only to the document and revision that requested it. Cancellation must also invalidate the response when a provider ignores abort.

Keep original source separate from authored versions. Preserve required disclosures and provenance when viewing, copying or exporting BiasLens output. Undo in a versioned investigation restores content through a new revision rather than deleting history. A text diff and an AI claim/citation assessment must remain visibly distinct.

URL, PDF, audio, video and screenshot ingestion occur before authoring. Preserve source anchors such as pages or timestamps. Extend existing extraction packages only when another real consumer needs that behavior; do not bundle the media pipeline into the editor.

Future audio/video generation should consume an accepted content version and produce separately versioned assets with source/version references, job status and provider provenance. Text revision invalidates derived assets rather than silently leaving stale narration attached. Reuse ai-kit media capabilities and speechkit measurement where applicable. Do not invent an unused universal media-job framework before inspecting the first actual generation flow.

Blog publication remains bip-kit territory: BiasLens currently binds its blog index and ArticleBody/ReadingProgress renderer; Heidi binds roadmap/changelog renderers. This does not establish that bip-kit has an authoring CMS. Authoring, reviewing and publishing are separate capabilities connected by explicit adapters. A future Loki customer app should install published packages and configure these adapters rather than clone OrangeCat's article page or acquire BiasLens's investigation schema.

## Product workflows

OrangeCat: one active draft, editor first, one Ask Cat entry point, contextual generation/editing actions, compact draft library, clearly separate preview and publishing. Keep ownership-safe legacy draft recovery.

BiasLens: one source/article workspace with Read, Talk, Check and Rewrite capabilities. A question does not silently edit the article. A rewrite creates a distinguishable version while preserving the original and its evidence context. Free writing can use the same authoring foundation without pretending that an unsourced draft has been checked.

Loki: inspect the remaining composer/builder work against these boundaries. Reuse a writing foundation only where Loki actually edits a document; keep task execution and project commands in their existing workflow. Do not force every text input into an article editor. The previously deployed Loki repair is independent of this extraction.

## Original migration order and acceptance

Original queue at planning time: first close the reported BiasLens rewrite overflow as a bounded repair. Review its existing sitekit dropdown separately; improve shared navigation upstream, not with a local mega-menu fork. Then resume OrangeCat authoring and package extraction, with Heidi as a design consumer before a reading feature is implemented. Maintain one active application implementation at a time under the fleet completion procedure.

Navigation acceptance: one shared renderer with host-supplied groups, descriptive links and active-route state; a desktop grouped panel and a phone layout that fits its viewport. Keep keyboard opening, Escape/focus return, outside-click dismissal, route-change dismissal and 44px targets. BiasLens supplies task groupings; sitekit owns markup and interaction. Inspect current sitekit main and open PRs before extending its installed flat-list API. Do not use a menu redesign as a reason to keep misleading destinations or duplicate writing doors.

1. Preserve the current OrangeCat patch as a candidate implementation. It has 23 focused passing tests; full verification and mobile/browser acceptance are outstanding. It is not a released fix.
2. Extract the smallest request/revision lifecycle and common editing behavior through the fleet package registration/release process. Add real OrangeCat and BiasLens adapters before expanding the API. Use host callbacks rather than new shared fetch wrappers.
3. Verify edits during generation, draft/account switches, cancellation followed by another request, stale title choices, and Undo after manual edits. Verify existing server revision conflicts and capability checks remain effective in BiasLens.
4. Release a published version and canary OrangeCat first. Check narrow mobile layouts, editor visibility, save/reload/recovery, generation, revision, preview and publishing behavior. Use the normal repository checks and fleet merge authority.
5. Migrate BiasLens with tests for preserved originals, labels in copied output, citations, evidence-led versions and conflict handling. Promote only after the first consumer is healthy.
6. Resume the remaining Loki builder, tenant, mobile keyboard and delivery audit recorded in the repair handoff. Keep its work separately verifiable.

Do not create another writing screen in either app during this migration. Do not automatically synchronize private drafts across products or publish analysis output to OrangeCat; any future handoff must be an explicit user action with source/provenance preserved.


## Verified checkpoint — continuation on 2026-11-05

Read this checkpoint before applying the original queue above. It records bounded
changes; the wider audits remain open. Use the repository completion procedure
for subsequent changes and retain exact source/deployment evidence in their PRs.

- BiasLens responsive repair [#187](https://github.com/bitbaum/biaslens/pull/187)
  deployed as `ed93e661d9e9988b1ce8133b6893c088064a057d`. Controlled source/rewrite
  journeys passed at 320/390/834/1440px against the served site, preserving labels
  and evidence notes. Later, another session's [#188](https://github.com/bitbaum/biaslens/pull/188)
  added a manual composer, written articles/responses, wire topics and explicit
  Post on OrangeCat. Its served receipt matches `5f88e9659dd43b1b62727b01350c3cc74fa98a4e`.
  Read its updated `docs/HANDOFF.md` and `docs/plans/2026-11-one-loop.md` before
  continuing; do not create a second implementation of that new composer.
- WritingKit extraction [OrangeCat #1563](https://github.com/bitbaum/orangecat/pull/1563)
  and repository registration [Fleet #476](https://github.com/bitbaum/fleet/pull/476)
  are complete. The package owns a pure revision/identity/cancellation coordinator,
  with no UI, HTTP, model, storage, evidence or language policy. Its standalone
  runtime/type-contract/packed-consumer checks passed. The verified Git artifact,
  rather than an npm publication, is recorded in the generated package registry;
  use that producer for version/install facts.
- OrangeCat [#1565](https://github.com/bitbaum/orangecat/pull/1565) merged through
  Fleet sweep as `d2dbb21ccc187c1350e0deb3a2fa13e749994847`. It adopts WritingKit,
  retires bootstrap source, puts the editor first and combines AI drafting/editing
  under Ask Cat. Draft library, safe Undo, collapsed optional metadata, touch
  targets and long-text wrapping passed browser checks. The sister-product import
  from #1564 preserves existing drafts and source-banner ownership. Draft-ID fallback
  now uses secure randomness. Full verification and normal hooks passed (5,681
  tests/684 files); final-source CI, CodeQL and browser checks passed before merge.
  The first browser runner timed out downloading Ubuntu fonts; the targeted rerun
  passed. Canary policy [Fleet #479](https://github.com/bitbaum/fleet/pull/479),
  generated catalogue [#480](https://github.com/bitbaum/fleet/pull/480), live binding
  audit and central rollout gate passed through normal review/sweep.
  [Main CI](https://github.com/bitbaum/orangecat/actions/runs/42071157777) and
  [CD](https://github.com/bitbaum/orangecat/actions/runs/42072988284) passed.
  The [served receipt](https://orangecat.ch/.well-known/fleet-release.json)
  matches the merged commit, WritingKit artifact and tested lockfile digest;
  CD's full staged-receipt verification passed. The served article index and
  signed-out writing gate passed read-only browser checks at all four widths.
- The article browser harness uses real components and product CSS with controlled
  AI/auth/publish/upload boundaries. It does not establish real signed-in article
  publication or physical OS-keyboard behavior. Keep these acceptance gaps explicit;
  inspect draft changes during an in-flight publish in the subsequent audit.
- Loki's bounded composer repair #1588 remains deployed. Other-session operations
  fixes through #1593 are served as `8454c0acaa3388637e0a889f20f963760d3effb6`.
  Its actual fleet-brief parser accepted the generated WritingKit row and pinned
  Git install command without a local package list or parser change. Its package
  pages require authentication; their signed-in UI was not verified here.
  Those commits do not close the builder/tenant/mobile/delivery/governance audit.

The [main browser workflow](https://github.com/bitbaum/orangecat/actions/runs/42071157688)
subsequently passed on the exact served commit. Its first article-writing runner
had timed out downloading Ubuntu font packages before tests; the targeted retry
completed the four-width writer checks. Main CI, both browser jobs, CD and the
served artifact now agree for the first canary. Subsequent consumers retain their
own required checks and staged rollout gates; no gate was waived.

Next extend sitekit's flat application navigation upstream, with BiasLens as the configured
canary, rather than creating a local menu fork. BiasLens one-loop consolidation
must preserve immutable sources, evidence/citation labels, capability checks,
server revision conflicts and version history when adopting WritingKit. Heidi's
reading adaptation is still unimplemented; preserve its target/bridge variety
packs and generated-language/provenance checks. Resume Loki's wider audit as a
separate verifiable scope. No private drafts synchronize automatically across apps.

The strict inventory producer proposed the catalogue before its independent
health-route duplication ratchet failed (18 to 20 files). No baseline was raised
and no gate was waived; that pre-existing fleet-wide duplication work remains open.
