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
and every other repo calls it as a reusable workflow — see "Auto-merge: call
it, never copy it" below for the caller.

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

## The shape around the gates (Rung 5 — audited by `cicd-hygiene-audit.sh`)

The four gates above say *what* must run. They say nothing about the pipeline
around them, and that shape has cost this fleet real deploys. Three rules,
each one written because it failed on 2026-09-07:

**1. CI may cancel superseded runs. A DEPLOY may not.**
`cancel-in-progress: true` is right for CI — an obsolete run is wasted minutes.
It is wrong for a deploy, where the cancelled thing is *shipping*. evig ran a
~13-minute deploy with cancel-on-push and **4 of its last 10 deploys were
cancelled — 40%, against 0% for every other repo measured**. Three cancelled
each other in a row and a merged fix needed three attempts to reach production.
Cancelling is only safe if the newer run is guaranteed to finish; at 13 minutes
it is not. Queue instead, and let the CI gate skip commits that main has already
moved past — `loki/scripts/hetzner/ci-gate.sh` returns a distinct
"superseded" exit code for exactly this.

**2. A deploy REQUIRES CI's green. It does not re-run it.**
evig's deploy ran `pnpm run verify` — the same bundle CI runs, concurrently, on
the same SHA. The commit was built **four times per merge** (CI's verify, CI's
e2e build, the deploy's verify, and the build inside the deploy script) and only
the last one shipped. Requiring the bundle to pass *once* is the same coverage.
Note the trap this hides: an earlier version of that step was genuinely weaker
than CI because it re-inlined a *subset* of the gates. The fix for that is to
depend on the full bundle, never to run a second copy of it.

**3. Cache the compiler's output.**
Next keeps its build cache in `.next/cache`. Measured across eight repos,
exactly **one** restored it in CI; everyone else recompiled from scratch every
run, then the deploy compiled again. Both templates here now include the step —
delete it only if the repo is not a Next app.

And the shape worth copying when a repo is ready for it: **build once, ship that
artifact**. `orangecat` is the only repo doing it, and its CD median is **2.5m
against a CI of 8.0m**. If you lift it, lift the packaging too — the standalone
output under pnpm is a symlink farm, and `actions/upload-artifact` does not
reliably preserve links, so it must travel as a **tarball** (see
`orangecat/.github/workflows/ci.yml`; a flattened tree dies at boot with
`Cannot find module '@swc/helpers/_/…'`).

These are ratcheted fleet-wide, so a new repo cannot quietly regress them:

```bash
scripts/ci/cicd-hygiene-audit.sh            # report
scripts/ci/cicd-hygiene-audit.sh --check    # exit 1 if a count rose
scripts/ci/cicd-hygiene-audit.sh --update   # move the baseline, in a PR
```

## Rung 6 — and who watches the watchers (`audit-health.sh`)

Everything above this line gates the repos. Until 2026-09-17, **nothing gated
the gates.** This repo runs twenty-one fleet-wide audits; a survey that day
found four of them not doing their job, with no signal anywhere:

| Audit | State | For how long |
|---|---|---|
| `email-canary` | RED — a **real finding**: the Resend sender domain every app sends through read unverified | that day, unread |
| `bus-factor` | RED — passes locally, not reproducible | 2 days |
| `dependabot-alerts` | RED — passes locally | 3 days |
| `hosted-supabase` | **CANCELLED** — so it audited nothing at all | 3 days |

Rung 4 says a gate that runs, reports success and means nothing is worse than
no gate, because it produces a ✓. **A gate that runs, reports FAILURE and is
never read is the same defect wearing the other colour** — the signal exists
and reaches nobody. A cancelled audit is the purest form: it did not look, and
its silence is shaped exactly like a clean sweep.

```bash
scripts/ci/audit-health.sh            # report
scripts/ci/audit-health.sh --check    # exit 1 if the watching layer is broken
```

It asks four questions per audit workflow: has it **ever run** (a workflow
GitHub refused parses as "no runs" — the dotfiles duplicate-key incident); was
its last run **green** (cancelled and timed-out are not); did it run **recently
enough for its own cron**; and does every `secrets.NAME` it references
**actually exist**.

**The staleness threshold is derived from each workflow's own `cron:`, never
configured here.** A table of cadences in the checker would be a second copy of
a fact the workflow already states — Ground Truth #2 violated by the script
that enforces it — and it would drift the first time someone changed a
schedule.

**This is the one audit that pushes.** Every other one reports into a job
summary, which is right: a human looks when they want the answer. That design
is precisely what failed here — nobody looked, for days, at four red audits. A
scheduled workflow nobody reads *is* the problem, so this one sends a single
Telegram per run (never per finding — see the detector that once sent a hundred
in one run), and the alert step goes red itself if the message is undeliverable.

#### The phantom secret: how an audit goes blind without failing

The fourth question is in this script rather than its own because a phantom
secret is *the mechanism* by which an audit lies. This is not an error in
Actions:

```yaml
GH_TOKEN: ${{ secrets.FLEET_READ_TOKEN || secrets.GITHUB_TOKEN }}
```

If `FLEET_READ_TOKEN` does not exist, the chain silently falls through to the
repo-scoped default token — which can see **one repo** — and the audit then
sweeps the fleet and reports it clean. `FLEET_READ_TOKEN` and
`FLEET_ADMIN_TOKEN` were referenced by **seven workflows here and have never
existed**; only `FLEET_PAT` does. That is the proven cause of the
`dependabot-alerts` red: with the default token, `repos/*/vulnerability-alerts`
is unreadable for every repo but this one.

It is the same family as the `2>/dev/null` bug documented above — *silence is
not data* — reached through configuration instead of code. Both let a check
stop checking while still reporting.

Secrets that are absent **on purpose** live in `scripts/ci/audit-health.allow`
with their reason, because the property is "its absence silently weakens a
gate", not "it is absent". `SWH_TOKEN` is the conforming case: optional, and
only lifts a rate limit. Flagging it would have been this repo's third false
positive after `ivy-portal` and `aoz-begleitung`, with the same cause each
time — **the rule encoding the first example it was written from rather than
the property that example illustrated.**

#### A follower that knows one package manager's flag

The sub-package follower in `verify-floor-audit.sh` carries a comment naming
`printcraft` as the repo it was written to fix — and `printcraft` went on being
charged for **all three gates** in every sweep after it shipped. Its verify is
`pnpm --dir app run verify`; the gates live in `app/package.json` exactly as
that comment describes; and the regex matched only npm's `--prefix`.

`--dir` and `-C` are pnpm's spellings of the same flag, **and the fleet is on
pnpm**. So the follower was written for the package manager the fleet does not
use, tested against the one it does not have, and its own documentation
asserted a repair that never happened. `printcraft` was reported as
`▲ FIXABLE — verify omits a gate the repo already has: lint typecheck test`
while its CI ran lint, typecheck, vitest, three Python pipeline tests, a build
and a standalone-output contract on every PR.

Generalisation worth carrying: **a comment claiming a bug is fixed is not
evidence that it is.** The cheapest check is to re-run the audit against the
repo the comment names and confirm it moved.

#### The audit's own worst bug, committed again by the script that reports it

The phantom-secret check went to CI and produced **twenty-one findings against
secrets that all exist** — `FLEET_PAT`, `TELEGRAM_BOT_TOKEN`, every one of
them. Listing secrets needs a scope the workflow token does not have, both
listings failed, and the code read the resulting empty set as *"no secrets
exist"*.

That is the same `2>/dev/null`-turns-an-outage-into-a-lie defect this file
already documents at length, in the script written to report that class of
defect, on its first live run. The rule it broke is the one stated three
sections above: **silence is not data.**

The fix is the same third state. Both listings must *succeed* before any
verdict is drawn; if either cannot be read the check is withheld out loud, and
never partially — a half-read listing charges every secret defined in the half
you could not see. `test-audit-health.sh` stubs a token that may not list
secrets and pins all three properties: nothing is charged, the withholding is
said aloud, and the run does not fail on an outage.

**A new rule's first finding deserves more suspicion than its hundredth.**
Twenty-one findings arriving at once, against a fleet that had none the day
before, was the tell — and the same arithmetic tell as the audit that inspected
24 repos in one run and 22 in the next.

#### The golden floor nobody could adopt

`ci-pnpm.yml` carried `version: 11` on `pnpm/action-setup@v4`. Every pnpm repo
checked — solon, ai-kit, threadkit, limitkit, bip-kit, sitekit, truthseeker —
had quietly dropped that line, because `packageManager` in package.json sets
the same thing and action-setup **hard-errors when both are present**, before
any step runs.

So the template could not be copied verbatim into a single fleet repo. Seven
adopters each fixed it locally and none fixed the source, which is how a
template stops being a template: the floor was the one shape nobody could
actually stand on. It surfaced only because listkit adopted it literally and
CI died in five seconds.

Worth generalising: **a template with no adopter that matches it is not a
source of truth, it is a fork with better branding.** Diff the template
against a repo that copied it whenever you touch either.

#### Proven by mutation, including on itself

`test-audit-health.sh` stubs `gh` and pairs every "bites" case with a quiet
case that shares its surface shape: red bites / healthy is silent; a *weekly*
audit silent for 20 days is stale / the same gap on a *monthly* cron is not; a
phantom bites / an org-level secret and a `workflow_call` secret **input** do
not; a 502 is withheld rather than charged as a finding.

That suite immediately earned itself. The live audit's staleness check **never
fired**, because splitting a cron expression with `set -- $cron` also *globs*
it — the `*` fields expand against the working directory, so `17 6 * * 1` was
read as a file listing and the day-of-week field came from whatever sorted
last. It passed a live run against the real fleet (nothing was stale that day)
and would have shipped as a column that could never go red: the exact shape
this file exists to find, in the file that finds it.

## Auto-merge: call it, never copy it

A green, non-draft PR merges and deploys itself. The policy is
`scripts/ci/auto-merge-sweep.sh` in this repo, exposed as the reusable workflow
`.github/workflows/auto-merge-sweep.yml` (`on: workflow_call`). A repo adopts it
by copying **`auto-merge.yml` from this directory** to
`.github/workflows/auto-merge.yml` and setting the `CHANGEME` lines. The whole
caller is:

```yaml
jobs:
  sweep:
    uses: bitbaum/fleet/.github/workflows/auto-merge-sweep.yml@main
    with:
      base_branch: main            # master in the older repos
      ci_workflow: ci.yml          # the FILE whose green run gates a merge
      rearm_workflows: 'ci.yml'    # SPACE-separated push-triggered workflows
      deploy_workflow: deploy.yml  # the reconciler — delete if the repo does not deploy
    secrets:
      token: ${{ secrets.FLEET_PAT }}
```

The triggers (`workflow_run` naming the CI workflow **exactly**, the schedule,
`workflow_dispatch`) and the `permissions` block stay on the caller — see the
template for why each line is there. Every other line is identical in every
repo, so a caller that differs from the template in anything but those values
is a question, not a customisation.

| Input | What it does | Wrong value looks like |
|---|---|---|
| `base_branch` | the branch PRs merge into | nothing merges, sweep exits 0 |
| `ci_workflow` | the workflow file whose green run gates a merge | PRs wait forever |
| `rearm_workflows` | dispatched after a merge, because a `GITHUB_TOKEN` push triggers nothing | a comma instead of a space: one bogus token, nothing ships, sweep still green |
| `deploy_workflow` | compared against the base tip each sweep and re-dispatched when behind | omitted on a repo that deploys: merged-but-not-live until someone notices |
| `token` | `FLEET_PAT` (org secret); a PAT-made dispatch emits `workflow_run`, so the queue drains at CI speed | unset falls back to `github.token` — merges, but only at the throttled schedule |

Verified 2026-09-15 from every repo's **default branch via the API**: 33 repos
carry an `auto-merge.yml`, 32 are callers of this workflow and the 33rd is this
repo running the script inline (it *is* the reusable workflow). Two things that
audit turned up are why the shape is now checked rather than trusted:

- **dotfiles** had two `secrets:` blocks under the same job. A YAML mapping
  cannot hold a key twice, so GitHub refused the file — the Actions tab listed
  the workflow by its *path* instead of its name and every run was a zero-job
  failure. The repo merged nothing for days and nothing said so.
- **substrata** and **camille-boulangerie** re-armed a `publish.yml` neither
  repo has. The sweep dispatched it after every merge, logged "could not
  dispatch", and exited 0.

`cicd-hygiene-audit.sh` therefore reports `automerge-miswired` for a caller with
a duplicate key, a caller that neither calls the reusable workflow nor runs the
canonical script, or a caller naming a workflow file the repo does not have.
Proven both ways in `test-cicd-hygiene-audit.sh` — including that two `- cron:`
items are not a duplicate key, the false positive the naive version would have
shipped with.

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
which `aoz-begleitung` does deliberately, fanning lint+typecheck, unit tests and
build into parallel jobs each with its own artifact. It was reported
`⊗ UNCALLED` from this audit's first run onward while in fact running all three
gates on every PR. **The rule was asking a conforming repo to serialize the
slowest pipeline in the fleet to satisfy a regex.**

botsmann is still caught, because the distinction is not "hand-copied" but
"hand-copied with a soft landing": every one of its steps carried
`--if-present`, so a rename passed silently. aoz-begleitung's carry none, so a
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
| `aoz-begleitung` | "no package.json — not a JS repo" | live Next.js app, 2,011-byte package.json |
| `ai-forms` | "CI never runs `verify`" | `ci.yml` line 19 is `npm run verify` |
| `loki` | "CI never runs `verify`" | `ci.yml` line 52 is `npm run verify` |

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
