#!/usr/bin/env node
/**
 * Does every live product carry a public identity, and exist where it claims?
 *
 *   product-identity-audit.mjs [--check] [--list] [--fixture FILE]
 *
 * WHY THIS EXISTS
 *
 * Six things are supposed to be true of every product we ship — problem,
 * solution, mission, vision, roadmap, changelog. All six already have a
 * producer: a Loki project profile. `problem`/`solution`/`mission`/`vision`
 * are canonical keys in loki `src/config/project-attrs.ts`, the roadmap is the
 * `goals` table, the changelog is `user_projects.dev_log`. They are edited in
 * the Context tab and injected into every agent dispatch, so the agent building
 * a product already reads them.
 *
 * None of that reaches a reader. Measured 2026-09-15 against the live register:
 *
 *   35 projects. `description` — the register's ONLY prose field — null on 35.
 *    7 of 35 have an OrangeCat profile, and two of those seven are dead
 *      experiments (dogfood-bridge-test-2026-09-06b, one-shot-slop-*).
 *    1 of 35 has a Solon organisation: OrangeCat itself.
 *   20 of 33 repos ship none of the six on their own site.
 *
 * And where a site DOES ship them they are hand-typed into a TypeScript
 * literal, which is why they rot: orangecat's public changelog has 13 entries,
 * newest dated 2026-07-31, while its main branch ran to PR #1039 on 2026-09-14.
 * Loki's own /changelog is a `redirect()`.
 *
 * Nobody was careless. There is simply no number anywhere that goes up when a
 * product ships and its public identity does not. This is that number.
 *
 * WHAT IS CHECKED — only the mechanical claims
 *
 *   1. a live/validating product has a non-empty description in the register
 *   2. a live/validating product has a site URL
 *   3. a live/validating product OWNED BY US has an OrangeCat profile
 *   4. ... and a Solon organisation
 *
 * Deliberately NOT checked: whether any of that prose is GOOD, or whether a
 * roadmap is ambitious, or whether a changelog entry describes the right
 * commit. A gate that guesses at prose gets muted, and every true finding
 * inside it is muted with it (see repo-metadata-audit.mjs, which makes the
 * same cut for the same reason).
 *
 * Work owned by someone else is scoped out: whether AOZ's housing app has a
 * Solon organisation is not ours to decide. `owner` comes from the register's
 * site row, which is apps.conf — a PROVISIONING fact about who the work
 * belongs to, not a public label. (bitbaum has no clients; publicly those
 * engagements are pilots and concepts.)
 *
 * WHAT IT CANNOT CHECK YET, AND WHY THAT IS THE POINT
 *
 * The six fields are not in the published payload. /api/fleet/register carries
 * {slug, name, description, repo, site, loki, orangecat, solon} and
 * /api/fleet/map carries {what, stack, layer, status, urls, next, now} — so
 * problem/solution/mission/vision/roadmap/changelog exist in the database and
 * are unreadable from outside it. FIELDS below is the list this audit checks;
 * it grows as Loki publishes them, and until then rule 1 stands in for all six
 * on the one prose field that IS published. Extending FIELDS is the whole
 * migration: nothing else here changes.
 *
 * THE BASELINE IS A RATCHET — counts may fall or hold, never rise.
 *
 * Reads the live register over HTTP, not a local checkout: this is about what
 * the world can see. A fetch that fails is NOT an empty gap list — the audit
 * exits 2 rather than reporting a clean sweep it did not perform.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = process.env.PRODUCT_IDENTITY_BASELINE || join(HERE, "product-identity.baseline");

export const MAP_URL = process.env.FLEET_MAP_URL || "https://loki.orangecat.ch/api/fleet/map";

/** A product is held to this standard once it is one of these. */
export const HELD_STATUSES = new Set(["live", "validating"]);

/** Ours to decide. Someone else's product is someone else's call. */
export const OUR_OWNER = "bitbaum";

/**
 * The identity fields this audit can see today, in the order a reader meets
 * them. `description` is the only one Loki publishes; the other six live in
 * `attributes` / `goals` / `dev_log` and are not in any payload yet. Add a row
 * here the day each is published — that is the entire extension path.
 */
export const FIELDS = [
  { key: "what", published: true, from: "user_projects.description", at: (p) => p.what },
  { key: "problem", published: true, from: "attributes", at: (p) => p.identity?.problem },
  { key: "solution", published: true, from: "attributes", at: (p) => p.identity?.solution },
  { key: "mission", published: true, from: "attributes", at: (p) => p.identity?.mission },
  { key: "vision", published: true, from: "attributes", at: (p) => p.identity?.vision },
  { key: "roadmap", published: true, from: "goals", at: (p) => p.roadmap },
  { key: "changelog", published: true, from: "dev_log", at: (p) => p.changelog },
];

/** Slugs a generated experiment left behind. They inflate every denominator. */
const LITTER = /^(factory-|dogfood-|one-shot-slop|website-design-development-)/;

/**
 * A project the audit is entitled to judge.
 *
 * A project that has not shipped is not held: holding it is how a gate fills
 * with rows nobody intends to fix, and a gate that is mostly noise gets muted.
 *
 * The map decides `status`, and that is why this reads the map rather than the
 * register. The register takes status from apps.conf, which deliberately omits
 * the handcrafted 4001-4004 services — so on the register `loki` and
 * `orangecat`, two of the three pillars, had no row at all and every rule here
 * skipped them while they served the public internet. The map resolves a
 * project with a live URL and no hosting row as live, which is the truth.
 */
export function isHeld(p) {
  if (!p || LITTER.test(p.slug)) return false;
  return HELD_STATUSES.has(p.status);
}

/** Is this identity field answered? A field is either prose or a list. */
function answered(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim() !== "";
}

/** Gaps on one map entry. One string per missing thing, or []. */
export function gapsFor(p) {
  const out = [];
  const ours = (p.owner ?? OUR_OWNER) === OUR_OWNER;

  for (const f of FIELDS) {
    if (!f.published) continue;
    if (!answered(f.at(p))) out.push(`no ${f.key}`);
  }

  if (!p.urls?.live) out.push("no site url");
  if (ours && !p.urls?.orangecat) out.push("no orangecat profile");
  if (ours && !p.urls?.solon) out.push("no solon org");

  return out;
}

/** Every held row's gaps, slug-sorted. */
export function findGaps(rows) {
  return rows
    .filter(isHeld)
    .map((row) => ({ slug: row.slug, name: row.name, gaps: gapsFor(row) }))
    .filter((r) => r.gaps.length > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Litter carried by the register — reported, never counted against the gate. */
export function litterIn(rows) {
  return rows.filter((r) => LITTER.test(r.slug)).map((r) => r.slug).sort();
}

/**
 * Projects the map knows about that are not live anywhere.
 *
 * Reported, never counted. A project with no address is not failing to have an
 * identity — it has not shipped, and holding it to a public standard is how a
 * gate fills with rows nobody intends to fix.
 *
 * This used to report the opposite problem: live projects the REGISTER could
 * not see, because apps.conf omits the handcrafted services. Reading the map
 * fixed that at the source — `loki` and `orangecat` are now judged like
 * everything else — so the blind spot this named no longer exists.
 */
export function notShipped(projects) {
  return projects
    .filter((p) => !LITTER.test(p.slug) && !HELD_STATUSES.has(p.status))
    .map((p) => p.slug)
    .sort();
}

export function readBaseline(path = BASELINE) {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== "object") throw new Error(`${url} -> not an object`);
  return body;
}

async function main() {
  const argv = process.argv.slice(2);
  const fixtureIdx = argv.indexOf("--fixture");

  let map;
  if (fixtureIdx !== -1) {
    const p = argv[fixtureIdx + 1];
    if (!p) {
      console.error("--fixture needs a path");
      process.exit(2);
    }
    map = JSON.parse(readFileSync(p, "utf8"));
  } else {
    try {
      map = await fetchJson(MAP_URL);
    } catch (err) {
      // A map we could not read is not a fleet without gaps. Exiting 0 here
      // would report a clean sweep that never happened — the failure mode this
      // repo's audits exist to avoid.
      console.error(`✗ could not read the fleet map: ${err.message}`);
      console.error("  not reporting a result. Fix the fetch, then re-run.");
      process.exit(2);
    }
  }

  const projects = Array.isArray(map.projects) ? map.projects : [];
  if (projects.length === 0) {
    console.error("✗ the map carried no projects — refusing to report zero gaps");
    process.exit(2);
  }

  const held = projects.filter(isHeld);
  const gaps = findGaps(projects);
  const litter = litterIn(projects);
  const unshipped = notShipped(projects);
  const total = gaps.reduce((n, r) => n + r.gaps.length, 0);

  console.log(`product identity — ${held.length} shipped of ${projects.length} projects`);
  console.log(`checking all ${FIELDS.length} identity fields\n`);

  for (const r of gaps) console.log(`  ${r.slug.padEnd(20)} ${r.gaps.join(", ")}`);
  if (gaps.length === 0) console.log("  no gaps");

  // Per-field totals: which of the six is the fleet worst at, in one glance.
  // A per-project list alone hides that (say) roadmap is missing nearly
  // everywhere while vision is nearly everywhere present.
  console.log("\n  by field, across the shipped projects:");
  for (const f of FIELDS) {
    const missing = held.filter((p) => gapsFor(p).includes(`no ${f.key}`)).length;
    const bar = "█".repeat(missing) + "·".repeat(held.length - missing);
    console.log(`    ${f.key.padEnd(10)} ${String(missing).padStart(2)} missing  ${bar}`);
  }
  for (const [label, has] of [
    ["orangecat", (p) => p.urls?.orangecat],
    ["solon", (p) => p.urls?.solon],
  ]) {
    const ours = held.filter((p) => (p.owner ?? OUR_OWNER) === OUR_OWNER);
    const missing = ours.filter((p) => !has(p)).length;
    console.log(
      `    ${label.padEnd(10)} ${String(missing).padStart(2)} missing  ` +
        "█".repeat(missing) +
        "·".repeat(ours.length - missing),
    );
  }

  if (litter.length > 0) {
    console.log(`\n  ${litter.length} generated experiment(s) still in the register, not counted:`);
    for (const s of litter) console.log(`    ${s}`);
    console.log("  tear-down: loki scripts/hetzner/retire-site.sh");
  }

  if (unshipped.length > 0) {
    console.log(`\n  ${unshipped.length} project(s) not live anywhere, not counted: ${unshipped.join(", ")}`);
  }

  console.log(`\ntotal gaps: ${total}`);

  if (argv.includes("--list")) return;

  if (argv.includes("--check")) {
    const baseline = readBaseline();
    if (baseline === null) {
      console.error(`✗ no baseline at ${BASELINE} — write one before gating`);
      process.exit(2);
    }
    if (total > baseline) {
      console.error(`\n✗ gaps rose ${baseline} -> ${total}. The baseline is a ratchet.`);
      console.error("  Fill the gap, or raise the baseline in the same PR so a human sees it.");
      process.exit(1);
    }
    console.log(`✓ ${total} <= baseline ${baseline}`);
    if (total < baseline) console.log(`  lower the baseline to ${total} to hold the ground.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
