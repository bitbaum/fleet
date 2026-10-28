# Complete repository work without fragmenting execution

This procedure records lessons from the package remediation work on 2026-10-28.
That work opened too many simultaneous threads, repeatedly checked old status,
duplicated expensive verification, and confused a merged dependency update with
complete adoption. Follow this procedure for multi-repository work.

## Establish a finite scope

Create a queue of repositories with explicit acceptance criteria and evidence
needed to close each item. For an app-wide package audit, list every applicable
package, its actual runtime bindings, remaining migration, required journey,
documentation and supported exception. Unknowns are investigation tasks, not
evidence of completion. Put new discoveries into the queue and explain whether
they are prerequisites, original requirements or separate future improvements.

## Keep one active application

Finish that application's declared scope before beginning implementation in
another application. A necessary shared-package, deployment or rollout fix is
a prerequisite: complete it and return to the active application. While required
checks run, prepare the same application's next step or its evidence record.
Do not open unrelated implementation threads merely because CI takes time.

At the start, inspect current main, current PR heads, local changes, instructions,
hooks, deployment path and disk capacity. Cached clones and old green checks
are not current evidence. Preserve existing work and reconcile other agents'
changes before editing.

## Verify once at the right stage

Read the repository's verification and push hooks first. Use focused checks while
editing, then complete the mandatory full checks through its normal path. Do
not run a full suite immediately before a hook that repeats it unless the
repository explicitly requires both. Re-run passed checks only after relevant
changes, a real failure or an unresolved concern. Do not bypass required gates.

Keep Git fixture processes isolated from hook-exported repository/index settings.
Keep generated dependencies and browser caches within available disk capacity;
prefer supported cache cleanup and preserve source and unfinished work.

## Close with evidence

Record code/lock versions, test results, migration proof where applicable, merge
commit, deployed commit or receipt, and the affected current-artifact journey.
Use the Fleet merge sweep as required by the repository's merge policy. Resolve
its stated hold rather than inferring that all green checks imply a merge.

Distinguish **implemented**, **checked**, **merged**, **deployed** and **exercised**.
A PR closure completes only its scope. Do not call an application fully audited
while its other declared acceptance criteria remain open. Record residual work
and supported exceptions explicitly, with a condition for revisiting them.

## Handle interruptions honestly

For a transient failure, retry a bounded number of times, inspect the actual
error and use the environment's supported network/authentication path. Continue
useful work within the active application's scope. Do not loop indefinitely,
weaken checks or create unrelated work to hide the blocked step.

If execution must stop, state that it stopped. Report the exact failed step,
attempted recovery, completed results, uncompleted acceptance criteria and next
action. Save branches, commits and resume instructions in the execution ledger.
Never imply ongoing background work after ending a turn unless a real tool job
is still running; identify that job and what its completion establishes.

## Evidence that the approach worked

On 2026-10-28, [Loki PR #1436](https://github.com/bitbaum/loki/pull/1436)
reached deployed merge commit `37c35b4b056813943bae3d983d0f9e7b6590041c`.
The served widget bundle matched the locally browser-tested build byte for byte
(SHA-256 `6a2ee5fb6b9c02b83edf29885fb162a56a0683056420c90f093ca01cf54da822`).
That work item closed; the broader app audit remained open. This establishes a completed work item, not completion of
the whole fleet audit. The procedure must continue to be checked against later
repository outcomes rather than being treated as a promise.
