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

export const REGISTER_URL =
  process.env.FLEET_REGISTER_URL || "https://loki.orangecat.ch/api/fleet/register";
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
  { key: "description", published: true, from: "user_projects.description" },
  { key: "problem", published: false, from: "attributes.key='problem'" },
  { key: "solution", published: false, from: "attributes.key='solution'" },
  { key: "mission", published: false, from: "attributes.key='mission'" },
  { key: "vision", published: false, from: "attributes.key='vision'" },
  { key: "roadmap", published: false, from: "goals" },
  { key: "changelog", published: false, from: "user_projects.dev_log" },
];

/** Slugs a generated experiment left behind. They inflate every denominator. */
const LITTER = /^(factory-|dogfood-|one-shot-slop|website-design-development-)/;

/**
 * A project the audit is entitled to judge.
 *
 * A row with no site row is not a product yet — it is a repo, or a name Loki
 * knows about. Holding those to a public-identity standard is how a gate fills
 * with rows nobody intends to fix, and a gate that is mostly noise gets muted.
 */
export function isHeld(row) {
  if (!row || LITTER.test(row.slug)) return false;
  const site = row.site;
  if (!site) return false;
  return HELD_STATUSES.has(site.status);
}

/** Gaps on one register row. One string per missing thing, or []. */
export function gapsFor(row) {
  const out = [];
  const ours = row.site?.owner === OUR_OWNER;

  for (const f of FIELDS) {
    if (!f.published) continue;
    const v = row[f.key];
    if (typeof v !== "string" || v.trim() === "") out.push(`no ${f.key}`);
  }

  if (!row.site?.url) out.push("no site url");
  if (ours && !row.orangecat) out.push("no orangecat profile");
  if (ours && !row.solon) out.push("no solon org");

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
 * Rows that are demonstrably live and that this audit still cannot judge.
 *
 * `site` comes from apps.conf, and apps.conf deliberately does not carry the
 * handcrafted 4001-4004 services. So on 2026-09-15 `loki` and `orangecat` —
 * two of the three pillars — plus `wild-spirit` each had `site: null` and were
 * skipped by every register-derived rule here, while serving the public
 * internet. bitbaum's own site is a fourth: a static Caddy vhost with no
 * apps.conf row AND no Loki live url, so it is invisible even to this.
 *
 * That is worse than a gap, because a gap is visible and this is not. It is
 * reported separately and loudly rather than folded into the count: folding it
 * in would let filling it look like progress on identity, when the fix is a
 * register row.
 */
export function unjudgeable(rows) {
  return rows
    .filter((r) => !LITTER.test(r.slug) && !r.site && r.loki?.liveUrl)
    .map((r) => ({ slug: r.slug, liveUrl: r.loki.liveUrl }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
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

  let register;
  if (fixtureIdx !== -1) {
    const p = argv[fixtureIdx + 1];
    if (!p) { console.error("--fixture needs a path"); process.exit(2); }
    register = JSON.parse(readFileSync(p, "utf8"));
  } else {
    try {
      register = await fetchJson(REGISTER_URL);
    } catch (err) {
      // A register we could not read is not a fleet without gaps. Exiting 0
      // here would report a clean sweep that never happened — the failure mode
      // this repo's audits exist to avoid.
      console.error(`✗ could not read the register: ${err.message}`);
      console.error("  not reporting a result. Fix the fetch, then re-run.");
      process.exit(2);
    }
  }

  const rows = Array.isArray(register.rows) ? register.rows : [];
  if (rows.length === 0) {
    console.error("✗ register carried no rows — refusing to report zero gaps");
    process.exit(2);
  }

  const held = rows.filter(isHeld);
  const gaps = findGaps(rows);
  const litter = litterIn(rows);
  const blind = unjudgeable(rows);
  const total = gaps.reduce((n, r) => n + r.gaps.length, 0);

  console.log(`product identity — ${held.length} held of ${rows.length} register rows`);
  console.log(`checking ${FIELDS.filter((f) => f.published).length} of ${FIELDS.length} identity fields (the rest are not published yet)\n`);

  for (const r of gaps) console.log(`  ${r.slug.padEnd(24)} ${r.gaps.join(", ")}`);
  if (gaps.length === 0) console.log("  no gaps");

  if (blind.length > 0) {
    console.log(`\n  ${blind.length} live project(s) this audit CANNOT judge — no register row:`);
    for (const b of blind) console.log(`    ${b.slug.padEnd(24)} ${b.liveUrl}`);
    console.log("  they serve the public internet and every rule above skips them.");
    console.log("  fix is a row in fleetcrown scripts/hetzner/apps.conf, not a field.");
  }

  if (litter.length > 0) {
    console.log(`\n  ${litter.length} generated experiment(s) still in the register, not counted:`);
    for (const s of litter) console.log(`    ${s}`);
    console.log("  tear-down: fleetcrown scripts/hetzner/retire-site.sh");
  }

  const unpublished = FIELDS.filter((f) => !f.published);
  if (unpublished.length > 0) {
    console.log(`\n  ${unpublished.length} field(s) exist in Loki but are absent from the payload:`);
    for (const f of unpublished) console.log(`    ${f.key.padEnd(12)} ${f.from}`);
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
