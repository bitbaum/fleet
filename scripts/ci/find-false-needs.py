#!/usr/bin/env python3
"""Fleet audit: which CI jobs WAIT on a job they never READ anything from?

`needs:` in a GitHub Actions workflow expresses THREE different things that look
identical in YAML:

  1. "I consume what that job produced."        <- value flow
  2. "Do not run me if it failed."              <- failure gate
  3. "I would prefer to run after it."          <- ordering

This script detects the absence of (1): a job has value flow only if it
downloads an artifact from the same run (`actions/download-artifact`) or
references `needs.<job>.outputs.*` / `needs.<job>.result`.

That is NOT the same as the wait being pointless, and conflating them is how you
break a pipeline. (2) is a genuine, load-bearing function — and in the fleet
sweep it is the MAJORITY of hits:

  openclaw  run_live_* needs authorize_actor       <- authorize before live secrets
  openclaw  publish_* needs *_approval             <- approval before publishing
  fleetcrown ship needs check                      <- never deploy a red build

Removing any of those would be a security or deploy regression, and every one of
them shows up in this report. The judgment the report cannot make for you is
whether the failure gate is worth the wall-clock it costs. It is worth it when
the successor is dangerous or expensive to run wrongly. It is NOT worth it when
the successor tests something independent — which is what (3) usually turns out
to be in disguise.

Measured instances that motivated this (2026-08-15/16):

  aoz-housing  E2E Tests            waited on build    +231s  serves its own app
  evig         Local E2E Journeys   waited on quality  +373s  self-contained
  evig         Inventory Smoke      waited on quality  +435s  tests LIVE prod
  evig         Auth Smoke Test      waited on quality  +434s  tests LIVE prod

THIS IS A REPORT, NOT A VERDICT. The claim is only that the cost should be a
decision someone made, not an accident inherited from a scaffold. A fleet sweep
on 2026-08-16 found 26 hits; roughly four fifths were deliberate failure gates
that must stay. Read the run timings before changing anything:

  gh api repos/OWNER/REPO/actions/runs/<id>/jobs \
    --jq '.jobs[] | {name, started_at, secs: ((.completed_at|fromdate)-(.started_at|fromdate))}'

Start timestamps are what prove a scheduling change landed — durations alone
cannot distinguish "it now runs in parallel" from "it got faster".

TWO TRAPS, both paid for in the instances above:

  * Fixing one layer exposes the next. evig #303 removed the e2e job's false
    `needs:` and the run went 709s -> 634s, not the predicted ~373s, because
    `quality -> inventory-smoke` had been hiding behind the old bottleneck and
    became the new critical path the instant it cleared. Re-run this audit
    AFTER every scheduling fix.

  * The obvious knob is rarely the big one. In aoz-housing the eye-catching
    defect was `workers: process.env.CI ? 1 : undefined` (the stock
    `npm init playwright` scaffold, which makes `fullyParallel: true` a no-op).
    Raising it bought 494s -> 346s — worth less than deleting one `needs:`,
    because the Playwright `webServer` was `npm run dev` and the workers all
    queued on it. Measure `.steps[]` before touching config.

Deliberately ONE central script that reads every repo REMOTELY, not a check
copied into each repo — same reasoning as verify-floor-audit.sh next door: the
auto-merge sweep was copied into 17 repos and now has 5 live variants, so a fix
in one reaches none of the others.

Usage:
  scripts/ci/find-false-needs.py                  # audit the whole fleet remotely
  scripts/ci/find-false-needs.py --local .        # audit a local checkout
  scripts/ci/find-false-needs.py --local a/ b/    # audit several checkouts
  scripts/ci/find-false-needs.py --strict         # exit 1 if anything is found

Env:
  GH_OWNER   GitHub owner to enumerate (default: maonakamoto)
  GH_LIMIT   max repos to inspect (default: 100)
"""
import json
import os
import pathlib
import re
import subprocess
import sys

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML:  pip install --user pyyaml")

OWNER = os.environ.get("GH_OWNER", "maonakamoto")
LIMIT = os.environ.get("GH_LIMIT", "100")


def gh(*args):
    """Ask GitHub a question. A 404 is an ANSWER (repo has no workflows), not a
    crash — so a failed call returns None rather than killing the sweep."""
    r = subprocess.run(("gh",) + args, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def consumed_deps(job_text, deps):
    """Which of `deps` does this job actually read a value from?"""
    return {d for d in deps if re.search(r"needs\." + re.escape(d) + r"\b", job_text)}


def scan_workflow(text, where):
    """Yield (job_name, deps, unused) for every job that waits without consuming."""
    try:
        doc = yaml.safe_load(text)
    except Exception as e:
        print(f"  !! could not parse {where}: {e}", file=sys.stderr)
        return
    if not isinstance(doc, dict) or "jobs" not in doc:
        return
    for name, job in (doc.get("jobs") or {}).items():
        if not isinstance(job, dict):
            continue
        needs = job.get("needs")
        if not needs:
            continue
        deps = [needs] if isinstance(needs, str) else list(needs)
        job_text = yaml.safe_dump(job)
        # An artifact download is a real dependency even with no `needs.` ref,
        # because the artifact can only have been produced earlier in this run.
        if "actions/download-artifact" in job_text:
            continue
        used = consumed_deps(job_text, deps)
        unused = [d for d in deps if d not in used]
        if unused:
            yield name, deps, unused


def scan_local(paths):
    for p in paths:
        root = pathlib.Path(p)
        for wf in sorted(root.glob(".github/workflows/*.y*ml")):
            for name, deps, unused in scan_workflow(wf.read_text(), str(wf)):
                yield str(wf), name, deps, unused


def scan_remote():
    out = gh("repo", "list", OWNER, "--limit", LIMIT, "--json", "name,isArchived")
    if not out:
        sys.exit(f"could not list repos for {OWNER} — is `gh` authenticated?")
    repos = [r["name"] for r in json.loads(out) if not r["isArchived"]]
    print(f"scanning {len(repos)} non-archived repos under {OWNER}…", file=sys.stderr)
    for repo in repos:
        listing = gh("api", f"repos/{OWNER}/{repo}/contents/.github/workflows")
        if not listing:
            continue  # no workflows — an answer, not an error
        try:
            entries = json.loads(listing)
        except json.JSONDecodeError:
            continue
        for entry in entries:
            if not entry["name"].endswith((".yml", ".yaml")):
                continue
            body = gh(
                "api",
                f"repos/{OWNER}/{repo}/contents/.github/workflows/{entry['name']}",
                "--jq", ".content",
                "--header", "Accept: application/vnd.github+json",
            )
            if not body:
                continue
            import base64
            try:
                text = base64.b64decode(body).decode("utf-8", "replace")
            except Exception:
                continue
            where = f"{repo}/.github/workflows/{entry['name']}"
            for name, deps, unused in scan_workflow(text, where):
                yield where, name, deps, unused


def main():
    argv = sys.argv[1:]
    strict = "--strict" in argv
    argv = [a for a in argv if a != "--strict"]

    if argv and argv[0] == "--local":
        findings = list(scan_local(argv[1:] or ["."]))
    else:
        findings = list(scan_remote())

    for where, job, deps, unused in findings:
        print(f"{where}\n  job {job!r} waits on {deps} but reads nothing from {unused}")

    n = len(findings)
    print(f"\n{n} job(s) wait without consuming.", file=sys.stderr)
    if n:
        print(
            "Each is a REPORT, not a verdict — confirm against real run timings\n"
            "before removing a `needs:`, and re-run this after every fix, because\n"
            "clearing one bottleneck promotes whatever was hiding behind it.",
            file=sys.stderr,
        )
    return 1 if (strict and n) else 0


if __name__ == "__main__":
    sys.exit(main())
