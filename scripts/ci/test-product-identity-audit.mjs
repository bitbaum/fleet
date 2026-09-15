#!/usr/bin/env node
// Tests for the product-identity audit.
//
// The judgement is a pure function of the register rows, so every case here
// runs with no network — the fixtures ARE shapes that were live on the
// /api/fleet/register payload on 2026-09-15, including the litter.
//
// Both directions, always: a clean row must produce no gap, and each defect
// must produce one AND be named. An audit that cannot go red is decoration.
//
// Run: node scripts/ci/test-product-identity-audit.mjs
import { isHeld, gapsFor, findGaps, litterIn, unjudgeable, FIELDS, HELD_STATUSES, OUR_OWNER } from "./product-identity-audit.mjs";

let pass = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const is = (a, b, m) => (a === b ? ok(m) : fail(`${m} (want ${JSON.stringify(b)}, got ${JSON.stringify(a)})`));
const has = (arr, s, m) => (arr.includes(s) ? ok(m) : fail(`${m} — got ${JSON.stringify(arr)}`));

const site = (over = {}) => ({ url: "https://x.orangecat.ch", host: "x.orangecat.ch", kind: "product", status: "live", owner: OUR_OWNER, since: "2026-01-01", ...over });

/** A row with nothing missing. */
const clean = (over = {}) => ({
  slug: "clean", name: "Clean", description: "A real sentence about the product.",
  repo: "clean", site: site(), loki: { id: "x", liveUrl: "https://x.orangecat.ch" },
  orangecat: { projectId: "oc-1" }, solon: { slug: "clean" }, ...over,
});

console.log("what the audit is entitled to judge");

is(isHeld(clean()), true, "a live product with a site row is held");
is(isHeld(clean({ site: site({ status: "validating" }) })), true, "so is a validating one");
is(isHeld(clean({ site: site({ status: "prospect" }) })), false, "a prospect is not held — it has not shipped");
is(isHeld(clean({ site: null })), false, "a row with no site row is a repo, not a product");
is(isHeld({ slug: "factory-sep11-0040", site: site() }), false, "generated experiment litter is never held");
is(isHeld({ slug: "dogfood-bridge-test-2026-09-06b", site: site() }), false, "...whatever its status says");
is(isHeld(null), false, "a missing row is not held");

console.log("\nthe gaps on one row");

is(gapsFor(clean()).length, 0, "a complete row has no gaps");
has(gapsFor(clean({ description: null })), "no description", "a null description is a gap");
has(gapsFor(clean({ description: "   " })), "no description", "and so is whitespace — the register publishes it as prose");
has(gapsFor(clean({ site: site({ url: null }) })), "no site url", "a shipped product without an address is a gap");
has(gapsFor(clean({ orangecat: null })), "no orangecat profile", "one of our products missing its OrangeCat profile is a gap");
has(gapsFor(clean({ solon: null })), "no solon org", "and its Solon organisation");

console.log("\nclient work is not ours to decide");

const client = clean({ slug: "aoz-housing", site: site({ owner: "AOZ", kind: "client-app" }), orangecat: null, solon: null });
is(gapsFor(client).length, 0, "a client app owes us no OrangeCat profile and no Solon org");
has(gapsFor({ ...client, description: null }), "no description", "but it still owes a description — that is the register's own field");

console.log("\nthe sweep");

const rows = [
  clean({ slug: "orangecat" }),
  clean({ slug: "heidi", description: null, solon: null }),
  clean({ slug: "solon", description: null, orangecat: null, solon: null }),
  clean({ slug: "prospect-thing", site: site({ status: "prospect" }), description: null }),
  { slug: "factory-sep11-0040", name: "factory", description: null, repo: "f", site: site(), loki: null, orangecat: null, solon: null },
];
const found = findGaps(rows);
is(found.length, 2, "only the two held-and-incomplete rows are reported");
is(found[0].slug, "heidi", "reported slug-sorted");
is(found[0].gaps.length, 2, "heidi is missing its description and its Solon org");
is(found[1].gaps.length, 3, "solon is missing description, OrangeCat profile and Solon org");
is(found.reduce((n, r) => n + r.gaps.length, 0), 5, "the total is gaps, not rows — a row with three holes counts three");
is(findGaps(rows.filter((r) => r.slug === "prospect-thing")).length, 0, "a prospect with no description is not a finding");

console.log("\nlitter is reported, never counted");
is(litterIn(rows).length, 1, "the generated experiment is named");
has(litterIn(rows), "factory-sep11-0040", "...by slug");

console.log("\nlive, and yet unjudgeable");
// The two flagship pillars and the studio site itself had site: null on
// 2026-09-15, because apps.conf does not carry the handcrafted 4001-4004
// services or bitbaum's static vhost. Silently skipping them is the failure
// this function exists to make loud.
const blindRows = [
  { slug: "loki", site: null, loki: { id: "l", liveUrl: "https://loki.orangecat.ch" } },
  { slug: "orangecat", site: null, loki: { id: "o", liveUrl: "https://orangecat.ch" } },
  { slug: "biaslens", site: null, loki: { id: "b", liveUrl: null } },
  { slug: "factory-sep11-0040", site: null, loki: { id: "f", liveUrl: "https://f.orangecat.ch" } },
  clean({ slug: "kivvi" }),
];
const blind = unjudgeable(blindRows);
is(blind.length, 2, "a live project with no register row is reported, not skipped");
is(blind.map((b) => b.slug).join(","), "loki,orangecat", "...named, slug-sorted");
is(unjudgeable(blindRows).some((b) => b.slug === "biaslens"), false, "a project with no live url is simply not live — not a blind spot");
is(unjudgeable(blindRows).some((b) => b.slug === "factory-sep11-0040"), false, "and litter is litter wherever it shows up");
is(findGaps(blindRows).length, 0, "the blind rows contribute nothing to the gap count — filling them is a register fix, not an identity one");

console.log("\nthe field list is the migration path");
is(FIELDS.filter((f) => f.published).length, 1, "exactly one identity field is published today");
is(FIELDS.length, 7, "seven are contracted: description plus the six");
is(FIELDS.filter((f) => !f.published).map((f) => f.key).join(","), "problem,solution,mission,vision,roadmap,changelog", "the six unpublished ones are named in reading order");
is(HELD_STATUSES.has("live") && HELD_STATUSES.has("validating"), true, "live and validating are the held statuses");

// Mutation proof: publishing a field MUST widen the audit. Without this the
// FIELDS table is decoration and rule 1 is the whole gate forever. Flip one
// row's `published` and a previously-clean product must go red.
const problem = FIELDS.find((f) => f.key === "problem");
problem.published = true;
is(gapsFor(clean()).length, 1, "publishing `problem` makes a row that lacks it fail");
has(gapsFor(clean()), "no problem", "...and names the field");
is(gapsFor(clean({ problem: "The learner is denied input because they are a learner." })).length, 0, "a row that carries it passes");
problem.published = false;
is(gapsFor(clean()).length, 0, "and the mutation is reverted");

console.log(`\n${pass} assertions passed`);
