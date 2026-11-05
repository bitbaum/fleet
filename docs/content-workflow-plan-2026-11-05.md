# Shared content foundation: OrangeCat, BiasLens, Heidi, and Loki

Status: researched proposal; no shared package created or deployed. The OrangeCat workflow repair remains an unshipped working tree on `fix/article-writing-workflow`. BiasLens was inspected without changes at `98281f2`.

This dated record captures the design decision, not current release status. Follow each product's handoff and pull request for implementation evidence. Previous bounded repairs were OrangeCat [#1562](https://github.com/bitbaum/orangecat/pull/1562) and Loki [#1588](https://github.com/bitbaum/loki/pull/1588); their wider audits remain open. The unfinished OrangeCat patch currently requires the original workspace or an explicitly transferred patch; the local branch name alone is not a remote backup.

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

## Migration order and acceptance

Current queue: first close the reported BiasLens rewrite overflow as a bounded repair. Review its existing sitekit dropdown separately; improve shared navigation upstream, not with a local mega-menu fork. Then resume OrangeCat authoring and package extraction, with Heidi as a design consumer before a reading feature is implemented. Maintain one active application implementation at a time under the fleet completion procedure.

Navigation acceptance: one shared renderer with host-supplied groups, descriptive links and active-route state; a desktop grouped panel and a phone layout that fits its viewport. Keep keyboard opening, Escape/focus return, outside-click dismissal, route-change dismissal and 44px targets. BiasLens supplies task groupings; sitekit owns markup and interaction. Inspect current sitekit main and open PRs before extending its installed flat-list API. Do not use a menu redesign as a reason to keep misleading destinations or duplicate writing doors.

1. Preserve the current OrangeCat patch as a candidate implementation. It has 23 focused passing tests; full verification and mobile/browser acceptance are outstanding. It is not a released fix.
2. Extract the smallest request/revision lifecycle and common editing behavior through the fleet package registration/release process. Add real OrangeCat and BiasLens adapters before expanding the API. Use host callbacks rather than new shared fetch wrappers.
3. Verify edits during generation, draft/account switches, cancellation followed by another request, stale title choices, and Undo after manual edits. Verify existing server revision conflicts and capability checks remain effective in BiasLens.
4. Release a published version and canary OrangeCat first. Check narrow mobile layouts, editor visibility, save/reload/recovery, generation, revision, preview and publishing behavior. Use the normal repository checks and fleet merge authority.
5. Migrate BiasLens with tests for preserved originals, labels in copied output, citations, evidence-led versions and conflict handling. Promote only after the first consumer is healthy.
6. Resume the remaining Loki builder, tenant, mobile keyboard and delivery audit recorded in the repair handoff. Keep its work separately verifiable.

Do not create another writing screen in either app during this migration. Do not automatically synchronize private drafts across products or publish analysis output to OrangeCat; any future handoff must be an explicit user action with source/provenance preserved.
