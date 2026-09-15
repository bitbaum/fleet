#!/usr/bin/env node
/**
 * readings.mjs — registers/readings.json: the numbers the whole bet rests on.
 *
 * "We believe our systems will work" earns the word "work" when it is
 * observed. This is the observation: every number the thesis depends on,
 * read from a source that is not us, once a night, kept as a time series.
 * Nobody types a reading. Zero is a reading.
 *
 *   stars, forks       GitHub, summed over the org's non-fork repos.
 *   downloads          npm downloads in the last 30 days, per shared package
 *                      in registers/packages.json. Honest caveat carried in
 *                      the file: our own CI installs count too.
 *   clients            loki's apps.conf plan|price columns for live rows:
 *                      paying (a price), favours (`favour|0`), unknown (`-`).
 *                      mrrChf sums the prices; every price there is CHF/month.
 *   originatorShare    what the Solon originator_share rule has routed to
 *                      originators. There is no ledger yet, so this is 0 with
 *                      its source named, not omitted.
 *
 * history[] gets a row whenever any reading CHANGES (not every night, or a
 * flat month is thirty identical commits), so the series reads as steps.
 * generatedAt moves only when a fact does, the packages.json rule.
 *
 *   node scripts/ci/readings.mjs --emit registers/readings.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ORG = process.env.ORG || "bitbaum";
const PACKAGES = process.env.PACKAGES_JSON || "registers/packages.json";
const APPS_CONF_REPO = process.env.APPS_CONF_REPO || "bitbaum/loki";
const APPS_CONF_PATH = process.env.APPS_CONF_PATH || "scripts/hetzner/apps.conf";

// ── pure ────────────────────────────────────────────────────────────────────

/**
 * apps.conf text -> client readings over live rows. A client is a live row
 * whose owner is not us: our own products have no terms to record, and
 * counting them as "unknown" would make seven products read as seven
 * clients nobody invoiced.
 */
export function readClients(appsConf, org = ORG) {
  const rows = appsConf
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("|"))
    .filter((f) => f.length >= 11 && f[8] === "live")
    .map(([name, , , , , , owner, kind, , plan, price]) => ({ name, owner, kind, plan, price }));
  const clients = rows.filter((r) => r.owner !== org);
  const paying = clients.filter((r) => r.price !== "-" && Number(r.price) > 0);
  const favours = clients.filter((r) => r.plan === "favour");
  const unknown = clients.filter((r) => r.price === "-");
  const mrrChf = paying.reduce((s, r) => s + Number(r.price), 0);
  return {
    live: rows.length,
    products: rows.length - clients.length,
    clients: clients.length,
    paying: paying.length,
    favours: favours.length,
    unknown: unknown.length,
    mrrChf,
  };
}

/** The scalar readings a history row records. */
export function readingsRow({ stars, forks, downloads, clients, originatorShare }) {
  return {
    stars,
    forks,
    downloads: Object.values(downloads).reduce((s, n) => s + (n ?? 0), 0),
    payingClients: clients.paying,
    mrrChf: clients.mrrChf,
    originatorSharePaid: originatorShare.paid,
  };
}

/**
 * The register. `previous` is the last emitted file, whose history is kept
 * and extended only when today's row differs from its last row.
 */
export function buildReadings({ date, stars, forks, downloads, clients, originatorShare, previous, generatedAt }) {
  const row = readingsRow({ stars, forks, downloads, clients, originatorShare });
  const history = [...(previous?.history ?? [])];
  const last = history[history.length - 1];
  const same = last && Object.keys(row).every((k) => last[k] === row[k]);
  if (!same) {
    if (last && last.date === date) history[history.length - 1] = { date, ...row };
    else history.push({ date, ...row });
  }
  return {
    generatedAt,
    org: ORG,
    current: {
      date,
      stars,
      forks,
      downloads: { lastMonth: row.downloads, byPackage: downloads },
      clients,
      originatorShare,
    },
    history,
    _notes: [
      "Every number is read from a source that is not us; nobody types a reading, and zero is a reading.",
      "stars and forks are summed over the org's non-fork repositories. downloads are npm's last-30-day counts per shared package and include our own CI installs.",
      "clients come from loki's scripts/hetzner/apps.conf over live rows whose owner is not us: paying has a price, favours are recorded as favour|0, unknown is '-'. mrrChf sums the prices. products counts our own live apps.",
      "originatorShare is what the Solon originator_share policy has routed to originators; until a ledger exists it is 0 by source, not by omission.",
      "history gains a row when any reading changes, so the series reads as steps; a flat month is one row.",
      "Derived by fleet/scripts/ci/readings.mjs.",
    ],
  };
}

// ── live sources ────────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function starsAndForks() {
  const repos = JSON.parse(gh(["repo", "list", ORG, "--limit", "500", "--json", "stargazerCount,forkCount,isFork"]))
    .filter((r) => !r.isFork);
  return {
    stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
    forks: repos.reduce((s, r) => s + r.forkCount, 0),
  };
}

async function npmDownloads(packagesJson) {
  const out = {};
  for (const p of packagesJson.packages ?? []) {
    if (p.install?.source !== "npm") continue;
    try {
      const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${p.name}`, { signal: AbortSignal.timeout(10000) });
      out[p.name] = res.ok ? (await res.json()).downloads ?? null : null;
    } catch {
      out[p.name] = null;
    }
  }
  return out;
}

function appsConf() {
  return gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${APPS_CONF_REPO}/contents/${APPS_CONF_PATH}`]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const emitIdx = process.argv.indexOf("--emit");
  const out = emitIdx >= 0 ? process.argv[emitIdx + 1] : null;
  if (emitIdx >= 0 && !out) { console.error("--emit needs a path"); process.exit(2); }

  const { stars, forks } = starsAndForks();
  const downloads = await npmDownloads(JSON.parse(readFileSync(PACKAGES, "utf8")));
  const clients = readClients(appsConf());
  if (clients.live === 0) { console.error("no live rows read from apps.conf — a token or path problem"); process.exit(1); }
  const originatorShare = { paid: 0, currency: "BTC", source: "solon originator_share policy: no ledger yet" };

  let previous = null;
  if (out && existsSync(out)) { try { previous = JSON.parse(readFileSync(out, "utf8")); } catch { previous = null; } }
  const date = new Date().toISOString().slice(0, 10);
  const payload = buildReadings({ date, stars, forks, downloads, clients, originatorShare, previous, generatedAt: new Date().toISOString() });

  const r = readingsRow({ stars, forks, downloads, clients, originatorShare });
  console.log(
    `readings ${date}: ${r.stars} stars, ${r.forks} forks, ${r.downloads} npm downloads/30d, ` +
      `${clients.paying} paying of ${clients.clients} clients (${clients.favours} favours, ${clients.unknown} unknown) + ${clients.products} own products, ` +
      `CHF ${r.mrrChf}/month, originator share paid ${r.originatorSharePaid} — history ${payload.history.length} row(s)`,
  );

  if (out) {
    const body = JSON.stringify({ ...payload, generatedAt: null });
    if (previous && JSON.stringify({ ...previous, generatedAt: null }) === body) payload.generatedAt = previous.generatedAt;
    writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
    console.log(`wrote ${out}`);
  }
}
