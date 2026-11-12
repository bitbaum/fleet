# The experience standard — plan and status

Rule: `AGENTS.md` → "The experience belongs to the package". Standard and
measured counts: `SHARED.md` → "The experience standard". This file is the
living plan: what is done, what is next, how to resume. A session that works on
it reads it first and **updates the status table last**, with what it
measured, not what it intended.

Owner's decision, 2026-11-06: packages own behaviour and the layout skeleton;
apps own words, backend and brand (tokens). Do not stop at one product — the
point is that the next product, and the one a non-technical person generates
tomorrow, starts at the standard.

## Where each piece lives (decided, not up for re-litigation)

No new repos. A new package needs an npm first-publish with a bootstrap token
(`SHARED.md` → "A new package gets its own repo by declaration"), which is a
human step, and `SHARED.md` says to extend the closest package before writing
a new one. The existing `/react` + `styles.css` convention is the shape.

| Piece                                                                   | Package            | Entry                                  |
| ----------------------------------------------------------------------- | ------------------ | -------------------------------------- |
| Any text field with a microphone, 16px, optional "improve"              | `@bitbaum/chatkit` | `DictationField` (`/react`)            |
| A comment thread (list + composer with mic + remove own)                | `@bitbaum/chatkit` | `CommentThread` (`/react`)             |
| A messenger: conversations, a thread between people and agents, files   | `@bitbaum/chatkit` | `Messenger` (`/messenger`); rules in `@bitbaum/threadkit` |
| Article composer: Speak, Improve, Photo, Chart, Preview, drafts, publish | `@bitbaum/writingkit` | `/react`: `ArticleComposer`, panels |
| Writing-help prompts, input and answer checks (headless)                | `@bitbaum/writingkit` | root: `assist`                       |
| Article page actions (primary + equal cells, owner row apart)           | `@bitbaum/writingkit` | `/react`: `ArticleActions`           |
| Header, menu, tab bar, footer, icons                                    | `@bitbaum/sitekit` | already shipped (0.7)                  |

Each component takes **transports**, never a database or vendor:
`publish(input)`, `assist(input)`, `searchPhotos(query)`, `transcribeUrl`,
`comments: { list, post, remove }`. Colour and type come from
`@bitbaum/design-tokens` through `--ck-*` / `--wk-*`.

## Status (update this table last)

| Step | What                                                                                   | State |
| ---- | -------------------------------------------------------------------------------------- | ----- |
| 1    | Direction recorded: `AGENTS.md`, `SHARED.md`, `templates/agent-rules.md` (propagates to every repo's `AGENTS.md` by PR) | done in fleet PR "The experience belongs to the package" |
| 2    | `scripts/ci/experience-audit.mjs`, wired into `package-composition-audit.mjs`; app template ceiling `{}` | done in the same PR |
| 3    | chatkit: `DictationField`, `CommentThread`                                              | see chatkit repo CHANGELOG |
| 4    | writingkit: `/react` composer, tools, `ArticleActions`; headless `assist`               | [ArticleComposer source](https://github.com/bitbaum/writingkit/commit/99fe5ae1c02827f8061cca7301439935f0173d37) exists; lifecycle acceptance and registered rollout pending; `ArticleActions` is not exported at that commit |
| 5    | BiasLens consumes them and deletes its copies; sets its ceiling                         | [lifecycle #194](https://github.com/bitbaum/biaslens/pull/194) deployed 2026-11-06; shared component migration and ceiling remain pending |
| 6    | OrangeCat adopts Speak/Improve and `DictationField` in its article composer; sets its ceiling | see orangecat CHANGELOG |
| 7    | Every other product: set ceiling to today's counts (`--init`), then migrate fields      | not started |
| 8    | OrangeCat's own header/footer/menu (3 files named as chrome) → sitekit                  | not started |
| 9    | evig (96 bare text areas), loki (34): the largest counts, so the largest wins           | not started |
| 10   | chatkit: `Messenger` (`/messenger`), `Composer layout="inline"`, file uploads through the app's transport | [chatkit #82](https://github.com/bitbaum/chatkit/pull/82), opened 2026-11-12 |
| 11   | threadkit 0.1.2: attachment policy, `readState`, mention matcher                        | merged as [threadkit #54](https://github.com/bitbaum/threadkit/pull/54) and tagged 2026-11-12; **not on npm**: its publish run was refused (`ENEEDAUTH`), because `publish.yml` is not linked as the package's trusted publisher on npmjs.com. Until it is, chatkit carries those rules in `src/thread-rules.ts` |
| 12   | OrangeCat's direct messages are the packaged Messenger; attachments in a private bucket | see orangecat CHANGELOG, 2026-11-12 |
| 13   | Messenger, next: remove chatkit's `src/thread-rules.ts` once threadkit 0.1.2 is on npm; presence (the transport event exists, OrangeCat does not emit it yet); voice messages as an attachment (the composer's microphone dictates, it does not record a message); the Cat reading a picture it is tagged under; a second adopter (`SHARED.md` names vitareba's care-team messaging as running on threadkit; its screen has not been read) | not started |

When a step is finished, replace its state with the PR that finished it and
the date; do not write "done" without a link.

## Carry lifecycle acceptance into the shared composer

The headless lifecycle integration in [BiasLens #194](https://github.com/bitbaum/biaslens/pull/194)
is a bounded prerequisite, not completion of steps 4–5. Its real-component
browser suite covers ignored abort, edit/revert and changed instructions, safe
Undo, Strict Mode, cancellation followed by new work, account/draft/report
switches, device-draft handoff, retries and preserved source/output labels.
Carry those cases into the package before replacing the consumer's local editor.

The inspected [ArticleComposer source](https://github.com/bitbaum/writingkit/blob/99fe5ae1c02827f8061cca7301439935f0173d37/src/react/ArticleComposer.tsx)
awaits `transport.assist` in `draftFromBrief`, then sets title/body directly.
That path does not use `WritingSession`; the assist transport has no cancellation
signal. Wire the existing coordinator into the component, extend the host
contract where necessary, and verify lifecycle/Undo/context changes in the
package and consumer. Keep original sources and versioned server writes in their
host adapters. Do not retire the verified protections during the UI migration.

Verify the newer component's registered release and install contract, then
canary it in OrangeCat before downstream promotion. A changelog or source export
alone is not that rollout evidence. Follow the current register for version and
installation facts rather than copying an unpromoted source ref into consumers.

## How to resume

1. `git fetch` this repo; read this file and `AGENTS.md` on `origin/main`.
2. `node scripts/ci/experience-audit.mjs --dir <product> --list` shows every
   file that still stands where a package owns the behaviour.
3. Pick the highest count. Replace the file with the component; if the
   component cannot do it, extend the package first (its test, its release),
   then consume it.
4. In the same PR, set or lower `experience.ceiling` in the product's
   `package-plan.json`. A ceiling only goes down.
5. Look at it at 390px and at desktop width, and say one real sentence into the
   microphone, before calling it done (`SHARED.md` → "Chat — the standard").

## Known limits of the measurement

- It reads source text. A `<textarea>` in a code editor, or a text area whose
  dictation would corrupt the content, is exempted with a first-line
  `// experience-exempt: <reason, 20+ characters>`.
- `localComments` counts files **named** like a comment list; a comment list
  inside a page file is not seen. Reading it as zero is not a clean bill.
- Single-line inputs are not counted: the audit cannot tell a name from prose.
  A prose-like single-line field (a title, a summary) belongs in
  `DictationField` too; that is a review question, not a mechanical one.
