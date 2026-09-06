# The Golden CI Floor

**One source of truth for what "a defended branch" means across every repo.**

Rung 2 of the efficiency ladder: the reason to have this is that automation only
multiplies you if it is *uniform*. When every repo has the same self-defending
floor, every agent in the fleet — and every human contributor on day one — gets
the same guarantees no matter which repo they land in. A good check trapped in
one repo helps one repo; the same check in the template helps all of them.

## What the floor guarantees

Every repo's `main` is protected by, at minimum, on every push and PR:

1. **Lint** — catches the undefined-identifier / dead-code class before merge.
2. **Typecheck** (`tsc --noEmit`) — the compiler is the first line of defence.
3. **Tests** — assertions that **exist** and actually *run*. Both halves are
   load-bearing: `jest` pointed at a repo with no test files can only ever fail,
   so it never gets wired in and its emptiness hides. (A bespoke script that
   carries its own assertions is fine — the defect is a file-discovering runner
   with nothing to discover.) Audited; see Rung 4.
4. **Build** — the app compiles into the artifact you ship (tested == shipped).

Passing all four is the *entry* condition, not the goal. A gate that runs and
cannot fail satisfies every line above and defends nothing — that is Rung 4.

These four are **hermetic**: they need no secrets, no live database, no network.
That is deliberate — a gate that goes red for want of a secret trains you to
ignore red. Anything that needs infra (e2e against a real DB, prod smoke,
migration replay) is an *upgrade* you add per-repo once the secrets exist. See
the ladder below.

## How to adopt (copy, don't reinvent)

- **pnpm repo** (every fleet repo since the 2026-09-04 pnpm sweep) → copy
  `ci-pnpm.yml` to `.github/workflows/ci.yml`.
- **npm repo** (none left in the fleet; template kept for forks/external work) →
  copy `ci-npm.yml` to `.github/workflows/ci.yml`.
- Adjust the `test`/`typecheck` step to match the repo's actual `package.json`
  script names. If a repo has no `typecheck` script, call `npx tsc --noEmit`
  directly (don't add a script just for CI).
- Commit on a branch and open a PR — the `pull_request` trigger runs the whole
  gate on the PR itself, so you *see it go green before it ever touches main*.

## The local mirror: a `verify` script (Rung 3 — close the loop)

CI protects the *shared* branch, asynchronously, after a push. That still leaves
a human running the app by hand to check a change before it ships. The `verify`
script removes that human: it gives an agent the **same signal, synchronously,
in one command, before pushing.**

Every repo exposes one script with an identical name and contract:

```jsonc
// package.json — mirrors the CI floor's HERMETIC gates
"verify": "<pm> run lint && <pm> run typecheck && <pm> run test"
```

- Same checks as CI (minus the non-hermetic build/e2e) → **green `verify` locally
  ⇒ green CI.** No surprises after push.
- Uniform name across every repo → an agent (or a new contributor) runs the same
  command everywhere and never has to learn a per-repo incantation.
- The reflex is encoded in each repo's CLAUDE.md: *before declaring a change done,
  run `verify` and read the result.* That is what takes the prompter out of the
  validate loop — the agent sees red and self-corrects in the same turn.

Add a `typecheck` script (`tsc --noEmit`) to any repo missing one so `verify` is
uniform. Deeper "drive the running app" smokes are a per-repo upgrade on top.

#### This contract is now audited

The sentence above was true on paper and false in practice — repos shipped a
`verify` that silently dropped a gate, so "verify is green" meant something
different in each one, while the merge train and auto-merge were built on top
of it meaning one thing.

```bash
scripts/ci/verify-floor-audit.sh              # exit 1 if any repo is below
scripts/ci/verify-floor-audit.sh --warn-only  # report only
```

It reads every repo remotely, on that repo's own default branch, and sorts
them three ways: **at floor**, **fixable** (the repo has the script, `verify`
just skips it — a one-line change), and **needs real work** (no such script
exists; adding a no-op to satisfy the floor would be theatre). It runs weekly
via `.github/workflows/verify-floor.yml`, reporting into the job summary.

Deliberately **one central script, not a copy per repo** — `auto-merge-sweep.sh`
was once copied into 22 repos and drifted into 8 live variants, so a fix landed
in one reached almost none of the others. It now lives canonically in this repo
and the fleet calls it as a reusable workflow (see SHARED.md for the last
local-copy holdouts).

**What it does not prove:** that each gate is *effective*. A `lint` script that
exists but silently does nothing passes. `sbb-lost-found` is the live example —
`next lint` prompts interactively because the repo has a flat config Next 14
cannot read, so lint has never actually run.

#### `continue-on-error` on a gate is worse than no gate

One effectiveness hole *is* checked, because the fleet already fell down it.
evig's CI ran the full unit suite on every PR and discarded the result with
`continue-on-error: true` — added as "non-blocking while the suite matures",
never flipped back. The suite matured to 7,769 tests. When the 2026-07-28
`primary-*` → `success-*` token sweep broke 25 assertions in 15 suites, CI ran
them, saw them fail, and reported green for three weeks.

That is strictly worse than having no test job: an absent gate is *visibly*
absent, while a discarded one manufactures a ✓. The audit now flags any step
that runs a floor gate under `continue-on-error`. It is scoped to floor gates
on purpose — a best-effort step with a real fallback (orangecat's `cd.yml`
artifact download, which builds from source if the download fails) is a
legitimate use and is not flagged.

**Rule:** if a check is not ready to block, don't wire it into CI green. Run it
on a schedule, or in a job nothing depends on — but never as a step that
reports success while failing.

## Rung 4 — a gate must be able to go red

The floor asks whether a gate **runs**. That question stopped discriminating
once nearly every repo passed it, and it was never the interesting one anyway.
On 2026-08-16 a single day's remediation turned up **five** different ways a
gate can run, report success, and mean nothing:

| Shape | Found in | What it looked like |
|---|---|---|
| Result discarded | evig | `continue-on-error: true` on the unit-test job — 7,769 tests ran on every PR and the answer was thrown away for three weeks |
| Never executed | sbb-lost-found | `next lint` hit an interactive setup wizard; the four services had no eslint config at all |
| Scope collapsed | sbb-lost-found | `eslint src/**/*.ts` runs through `sh`, where `**` is `*` — it linted `utils/logger.ts` and skipped every `index.ts` |
| Nothing to run | sbb-lost-found | `test: jest` in four packages, **zero test files in the repo** — a runner with nothing to discover |
| Wrong rung | datacat | `test` is `npx playwright test` — needs a browser and a server, so it is an upgrade, not the floor |

Every one passed a "does the repo have a `test` script?" check. None of them
defended anything.

**The standard:** for each gate, you must be able to name the change that makes
it fail. If you cannot, it is decoration — and decoration is worse than nothing,
because it produces a ✓.

**How you demonstrate that — mutation, not argument.** Break the thing on
purpose, confirm red, restore. Worked example from the tenant SSOT in
`sbb-lost-found`, whose job is to decide whose trademark renders:

```
baseline (unmutated)                        exit 0   ← expected
themeColor drifts from --brand              exit 1   ← caught
default tenant becomes a trademarked one    exit 1   ← caught
unknown env value no longer forced to default  exit 1   ← caught
```

Three invariants, three deliberate breaks, three reds. That is evidence. "We
have 45 tests" is not.

**The same rule applies to any rule you write.** A lint rule, grep gate or audit
column proven only on the case that should fire says nothing about what it lets
through. Test both directions — the discarded-gate check above was verified
against evig's `ci.yml` (must fire), orangecat's `cd.yml` (must stay silent, it
is a legitimate best-effort fallback), and the repaired evig file (must stay
silent).

That is not a formality. The no-test-files check in this very section produced a
**false positive on its first live run**: it flagged `ivy-portal`, whose `test`
is `node scripts/smoke.mjs` — a zero-dependency script that boots the real
server, asserts a 200, and exits with the true code. It has no test *files*
because it carries its own assertions. The rule's premise — *"it can only ever
fail"* — was true of `jest` pointed at nothing and false here, so it was narrowed
to file-discovering runners before it shipped. **A new rule's first finding
deserves more suspicion than its hundredth, not less:** it is the one you have no
calibration for.

**What is now audited centrally**, so these cannot silently return:

- a step that runs a floor gate under `continue-on-error` → `⊘ DISCARDED`
- a file-discovering test runner with no test files → `test(runner-no-files)`
- a `test` script that only drives a browser → `test(e2e-only)`
- a gate `verify` composes that no workflow runs → `⊗ UNCALLED`
- `verify` invoked or written so it cannot fail → `⊙ SOFTENED`

**What is still yours to prove:** that each gate is *effective*. No central
audit can know whether your assertions would survive the bug you actually
ship. That is what the mutation habit is for.

**Where the bar goes next, on the evidence.** The floor catches the
undefined-identifier and type-error classes. It has never caught the ones that
actually cost something here, every one of which shipped past a green suite:

- a response handler returning `json(user)` with `passwordHash` and a PIN hash
  in it — **twice**, the second time one nesting level deeper (`{ok, user}`),
  which is why a grep cannot close it and an allow-list exhaustive over the
  schema can;
- identity taken from the request **body** instead of the session, letting one
  member vote as another;
- a query missing its tenant filter — correct at one org, wrong at two, and
  production had exactly one.

The shape is constant: **the gate asserts what the code does, not what it must
never do.** Rung 5 is gating the closed side — write the test that fails when
the field leaks, the identity is spoofed, or the scope is dropped. Until a repo
has that, "verify is green" means the code compiles and behaves, not that it is
safe.

## The maturity ladder (add per-repo as the secrets/infra appear)

The floor is rung 0. Reach for the next rung when the repo earns it — the
reference implementations already exist, lift them:

| Upgrade | Lift it from | Add when |
|---|---|---|
| Secret scan (gitleaks) in CI | `orangecat/.github/workflows/ci.yml` (`security` job) | always, once green |
| Committed-secret pre-commit hook | `botsmann/.husky/pre-commit` | repo has contributors |
| Dependency audit gate | `orangecat` `security` job | always, once green |
| e2e against a seeded DB | `evig/.github/workflows/ci.yml` (`e2e-local` job) | repo has Playwright specs |
| Migration drift replay | `evig` (`migrations` job) | repo owns SQL migrations |
| CodeQL SAST | `orangecat/.github/workflows/codeql.yml` | repo is security-sensitive |
| P0 e2e matrix + build artifact | `orangecat/.github/workflows/ci.yml` | flagship / shipping repo |

**Rule:** the second time you hand-fix a class of bug, it becomes a gate here —
not a third manual fix. This template is where "never fix it twice" lives.

#### The other half: is `verify` actually WIRED UP?

Everything above audits what `verify` **contains**. A repo can satisfy every one
of those rules and still have nothing that runs it — so the same audit now also
answers the wiring question, in the same pass, from the workflow bodies it
already fetches:

| Rule | Reported as | Why it is a rule |
|---|---|---|
| every gate in `verify` also runs in CI | `⊗ UNCALLED` | a repo can hand-copy the steps, then drift from them |
| …by name rather than via `verify` | `≡ DECOMPOSED` | **not a violation** — see below |
| no `--if-present` on any of them | `⊙ SOFTENED` | renaming the script turns its gate into a silent pass |
| `verify` has no `\|\| true` / `--if-present` inside | `⊙ SOFTENED` | CI faithfully runs a gate that cannot fail |

botsmann is why this exists. Its `verify` was perfect — `format:check + lint +
test + build` — so the content audit correctly called it **at floor**. Its CI
never called it: the same four steps were hand-copied with `--if-present` on
each, so renaming any of them would have been a silent pass.

#### …but "calls `verify`" was a proxy, and the proxy was wrong

The first version of this rule matched the **string** `npm run verify`. The
property worth having is weaker and more useful:

> every gate `verify` composes also runs in CI, **unsoftened**.

Calling `npm run verify` satisfies that. So does calling each script by name —
which `aoz-housing` does deliberately, fanning lint+typecheck, unit tests and
build into parallel jobs each with its own artifact. It was reported
`⊗ UNCALLED` from this audit's first run onward while in fact running all three
gates on every PR. **The rule was asking a conforming repo to serialize the
slowest pipeline in the fleet to satisfy a regex.**

botsmann is still caught, because the distinction is not "hand-copied" but
"hand-copied with a soft landing": every one of its steps carried
`--if-present`, so a rename passed silently. aoz-housing's carry none, so a
rename fails CI exactly as hard as it fails `verify`.

The residual risk in the decomposed shape is real and is why it stays reported
rather than being dropped: **a gate added to `verify` later does not reach CI by
itself.** The check now watches for precisely that — it decomposes `verify` and
demands each part appear — instead of watching for a word.

That is the second false positive from this audit's own rules in one day, after
the no-test-files rule flagged `ivy-portal`. Both had the same shape: **the rule
encoded the first example it was written from, not the property that example
illustrated.** botsmann's hand-copy was softened, so "hand-copied" got treated as
the defect; `jest` with no files can only fail, so "no test files" got treated as
the defect. Write the rule against the property, then find a conforming repo that
does it differently and check the rule stays quiet.

The rules live in `scripts/ci/verify-predicates.sh` rather than inline, so they
can be tested against fixtures without reaching GitHub — the audit is remote-only
by design, and a rule that can only be exercised by a live API call is a rule
nobody re-tests after editing its regex. `test-verify-predicates.sh` (run by this
repo's CI) proves each rule bites **and** that conforming shapes are not flagged.
Both directions matter: a checker that cries wolf gets ignored, which is the same
end state as no checker, reached more expensively.

#### The audit's own worst bug: a failed fetch reported as a finding

Every remote read was `gh api … 2>/dev/null`, and the empty string a failure
yields was then read as a **fact**. One sweep on 2026-08-16 produced **four
wrong verdicts** from that single conflation:

| Repo | Reported | Truth |
|---|---|---|
| `vitareba` | "no package.json — not a JS repo" | live Next.js app, 1,339-byte package.json |
| `aoz-housing` | "no package.json — not a JS repo" | live Next.js app, 2,011-byte package.json |
| `ai-forms` | "CI never runs `verify`" | `ci.yml` line 19 is `npm run verify` |
| `fleetcrown` | "CI never runs `verify`" | `ci.yml` line 52 is `npm run verify` |

Two of them were **silently dropped from the floor entirely** — not flagged,
not counted, just absent from the report. An audit that quietly stops auditing
a repo is the exact failure this file exists to prevent, committed by the file's
own enforcement script.

**The tell was arithmetic, not intuition.** Two runs an hour apart inspected
**24** and **22** repos, with no repo created or deleted between them. A check
whose output moves while the thing it measures holds still is not measuring it.
If your audit reports a count, diff the count between runs — that is the cheapest
non-determinism detector there is.

**The fix is a third state.** Fetches now return `0 = fetched`, `2 = genuinely
absent (404)`, `1 = could not look`, and every caller **withholds** its verdict
on `1` instead of charging the repo. A 404 is an answer and is not retried; a
403/5xx is retried with backoff and, if it persists, reported as unreadable.
An exhausted rate limit is also not retried — it too is an answer, about the
transport rather than the repo, and no backoff measured in seconds outlives a
window measured in hours. The first post-fix sweep proved both halves at once:
it hit the rate limit mid-run, withheld 29 verdicts honestly instead of
inventing 29 findings, and spent 3× the calls rediscovering the same exhausted
limit — hence the fail-fast.

**Why it survived so long:** nothing could reach the failure path without a real
outage. `gh_get` therefore lives in `verify-predicates.sh` with the rules, and
`test-verify-predicates.sh` stubs `gh` to exercise all three states — including
that a transient failure recovers on retry and that a 404 does *not* burn three
calls. Proven by mutation: collapsing `return 1` back to `return 2` turns exactly
two cases red.

> Generalisation worth carrying: **`2>/dev/null` on a read you will draw a
> conclusion from converts an outage into a lie.** Silence is not data. If a
> tool cannot distinguish "absent" from "unreachable", every clean report it
> produces is unfalsifiable.

**Audit remotes, never local checkouts.** A first attempt at this swept working
trees under `~/dev` and reported two violations that had already been fixed on
`main` — the checkouts were stale — which produced one redundant PR and one that
would have silently dropped an unrelated gate added meanwhile. The default
branch is the only ground truth about what defends a repo.
