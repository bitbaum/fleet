# Contributing

Anyone can join or fork this work. What this file settles is what happens to
a contribution once it lands, so that the option to change the licence later
stays with the project and the credit for a change stays with its author.

## What your sign-off means

Every commit in an outside pull request must carry a sign-off line:

    Signed-off-by: Your Name <you@example.org>

`git commit -s` adds it. By adding it you certify two things.

**1. The Developer Certificate of Origin, version 1.1.** In short: you wrote
the change, or have the right to submit it under this project's licence, and
you understand the contribution and your sign-off are public and permanent.
Full text: <https://developercertificate.org/>.

**2. A licence grant to the project.** You grant Cato, the maintainer, a
perpetual, worldwide, royalty-free, irrevocable licence to use, reproduce,
modify, distribute and sublicense your contribution, and to release it under
any licence the project adopts in future. You keep your copyright and every
right to use your own work elsewhere. This grant is what makes it possible to
relicense without tracking down every past contributor for consent.

Pull requests from outside the organisation are merged by an automated sweep
that checks for the sign-off on every commit and holds the PR, naming the
commit, until it is there. Members commit under the maintainer's own identity
and are not asked to certify to themselves.

## Origin

Git dates are set by whoever commits, so they prove nothing about who was
first. The organisation stamps every repository's HEAD nightly through
OpenTimestamps and asks Software Heritage to archive it, and publishes the
proofs in `bitbaum/fleet` under `proofs/origin/`. Your signed-off commit
becomes part of that record the night it lands.

## The usual

Run the repository's `verify` script before opening a PR. Keep a PR to one
change. Write the commit message for the person reading `git log` in a year.
