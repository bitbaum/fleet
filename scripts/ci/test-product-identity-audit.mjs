#!/usr/bin/env node
// Tests for the product-identity audit.
//
// The judgement is a pure function of the fleet map's projects, so every case
// here runs with no network — the fixtures are shapes served by
// /api/fleet/map on 2026-09-15, including the litter.
//
// Both directions, always: a complete project must produce no gap, and each
// missing thing must produce one AND be named. An audit that cannot go red is
// decoration, so the FIELDS table is also exercised by mutation.
//
// Run: node scripts/ci/test-product-identity-audit.mjs
import {
  isHeld,
  gapsFor,
  findGaps,
  litterIn,
  notShipped,
  FIELDS,
  HELD_STATUSES,
  OUR_OWNER,
} from "./product-identity-audit.mjs";

let pass = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const is = (a, b, m) => (a === b ? ok(m) : fail(`${m} (want ${JSON.stringify(b)}, got ${JSON.stringify(a)})`));
const has = (arr, s, m) => (arr.includes(s) ? ok(m) : fail(`${m} — got ${JSON.stringify(arr)}`));

/** A project with nothing missing. */
const complete = (over = {}) => ({
  slug: "complete",
  name: "Complete",
  what: "A real sentence about the product.",
  status: "live",
  owner: OUR_OWNER,
  identity: {
    problem: "What hurts.",
    solution: "What we built.",
    mission: "Why.",
    vision: "Where it goes.",
  },
  roadmap: [{ title: "Ship it", status: "active", progress: 10, targetDate: null, milestones: [] }],
  changelog: [{ date: "2026-09-14", done: "Shipped something." }],
  urls: {
    live: "https://x.orangecat.ch",
    repo: "https://github.com/bitbaum/x",
    orangecat: "https://orangecat.ch/projects/1",
    solon: "https://solon.orangecat.ch/orgs/x",
  },
  ...over,
});

console.log("what the audit is entitled to judge");

is(isHeld(complete()), true, "a live project is held");
is(isHeld(complete({ status: "validating" })), true, "so is a validating one");
is(isHeld(complete({ status: "prospect" })), false, "a prospect is not held — it has not shipped");
is(isHeld(complete({ status: "not live" })), false, "neither is one that is not live");
is(isHeld({ slug: "factory-sep11-0040", status: "live" }), false, "generated experiment litter is never held");
is(isHeld({ slug: "dogfood-bridge-test-2026-09-06b", status: "live" }), false, "...whatever its status says");
is(isHeld(null), false, "a missing project is not held");

// The map resolves a project with a live URL and no apps.conf row as live.
// That is why this audit reads the map: on the register, loki and orangecat had
// no row at all and every rule skipped them while they served the internet.
is(isHeld(complete({ slug: "loki" })), true, "a pillar with no hosting row is judged like everything else");

console.log("\nthe six, plus the line that introduces them");

is(gapsFor(complete()).length, 0, "a complete project has no gaps");
has(gapsFor(complete({ what: null })), "no what", "a missing one-line description is a gap");
has(gapsFor(complete({ identity: {} })), "no problem", "a missing problem is a gap");
has(gapsFor(complete({ identity: {} })), "no solution", "...solution");
has(gapsFor(complete({ identity: {} })), "no mission", "...mission");
has(gapsFor(complete({ identity: {} })), "no vision", "...vision");
has(gapsFor(complete({ roadmap: [] })), "no roadmap", "an empty roadmap is a gap");
has(gapsFor(complete({ changelog: [] })), "no changelog", "an empty changelog is a gap");
is(gapsFor(complete({ identity: {} })).length, 4, "all four attrs are counted separately");

// Prose and lists are both "answered", and both have an empty form.
has(gapsFor(complete({ what: "   " })), "no what", "whitespace prose is not an answer");
is(gapsFor(complete({ roadmap: undefined })).includes("no roadmap"), true, "a missing list is not an answer");

console.log("\nthe three surfaces");

has(gapsFor(complete({ urls: { live: null } })), "no site url", "a shipped product without an address is a gap");
has(gapsFor(complete({ urls: { ...complete().urls, orangecat: null } })), "no orangecat profile", "a missing OrangeCat profile is a gap");
has(gapsFor(complete({ urls: { ...complete().urls, solon: null } })), "no solon org", "...and a missing Solon organisation");

console.log("\nwork owned by someone else is not ours to decide");

const theirs = complete({ slug: "aoz-begleitung", owner: "AOZ", urls: { ...complete().urls, orangecat: null, solon: null } });
is(gapsFor(theirs).length, 0, "someone else's product owes us no OrangeCat profile and no Solon org");
has(gapsFor({ ...theirs, what: null }), "no what", "but it still owes a description — that is its own field");
is(gapsFor(complete({ owner: undefined })).length, 0, "an absent owner defaults to ours, not to exempt");

console.log("\nthe sweep");

const projects = [
  complete({ slug: "orangecat" }),
  complete({ slug: "heidi", roadmap: [], urls: { ...complete().urls, solon: null } }),
  complete({ slug: "prospect-thing", status: "prospect", what: null, roadmap: [] }),
  { slug: "factory-sep11-0040", name: "factory", status: "live", identity: {}, roadmap: [], changelog: [], urls: {} },
];
const found = findGaps(projects);
is(found.length, 1, "only the held-and-incomplete project is reported");
is(found[0].slug, "heidi", "reported slug-sorted");
is(found[0].gaps.length, 2, "heidi is missing its roadmap and its Solon org");
is(found.reduce((n, r) => n + r.gaps.length, 0), 2, "the total is gaps, not projects");
is(findGaps([projects[2]]).length, 0, "a prospect with nothing written is not a finding");

console.log("\nreported, never counted");
is(litterIn(projects).length, 1, "the generated experiment is named");
has(litterIn(projects), "factory-sep11-0040", "...by slug");
is(notShipped(projects).join(","), "prospect-thing", "a project that is not live is listed, not judged");
is(notShipped(projects).includes("factory-sep11-0040"), false, "litter is litter wherever it shows up");

console.log("\nthe contract");
is(FIELDS.length, 7, "seven fields: the one-line what, plus the six");
is(FIELDS.filter((f) => f.published).length, 7, "all seven are published and therefore checked");
is(FIELDS.map((f) => f.key).join(","), "what,problem,solution,mission,vision,roadmap,changelog", "named in reading order");
is(HELD_STATUSES.has("live") && HELD_STATUSES.has("validating"), true, "live and validating are the held statuses");

// Mutation: every field must be load-bearing. Un-publishing one has to stop it
// being counted — otherwise the table is decoration and the rules are hardcoded
// somewhere else.
for (const f of FIELDS) {
  const before = gapsFor(complete({ what: null, identity: {}, roadmap: [], changelog: [] })).length;
  f.published = false;
  const after = gapsFor(complete({ what: null, identity: {}, roadmap: [], changelog: [] })).length;
  f.published = true;
  is(after, before - 1, `un-publishing \`${f.key}\` removes exactly its own check`);
}

console.log(`\n${pass} assertions passed`);
