#!/usr/bin/env node
/**
 * Self-test for readings.mjs. No network, no gh.
 *
 * The register is a public statement of the numbers the bet rests on, so the
 * assertions are about not lying: a favour is not a paying client, '-' is
 * unknown not zero, a package npm could not answer for is null not zero, and
 * history grows only when a reading changes — a flat month is one row, and a
 * same-day rerun replaces rather than duplicates.
 */

import { buildReadings, readClients, readingsRow } from "./readings.mjs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ""}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));

console.log("clients from apps.conf");
const conf = `# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
paid|4001|paid.example|/x/paid|.|paid|Client A|client-app|live|monthly|650|2026-01-01
gift|4002|gift.example|/x/gift|.|gift|Client B|client-app|live|favour|0|-
dunno|4003|dunno.example|/x/dunno|.|-|Client C|client-site|live|-|-|-
ours|4004|ours.example|/x/ours|.|ours|bitbaum|product|live|-|-|-
soon|4005|-|/x/soon|.|-|Client D|client-app|prospect|monthly|9999|-
`;
const c = readClients(conf, "bitbaum");
eq(c.live, 4, "counts live rows only");
eq(c.products, 1, "our own live app is a product, not a client");
eq(c.clients, 3, "clients are live rows owned by someone else");
eq(c.paying, 1, "a price above zero is a paying client");
eq(c.favours, 1, "favour|0 is a favour, not a paying client and not unknown");
eq(c.unknown, 1, "'-' on a client row is unknown, not zero; '-' on our own row is not a client at all");
eq(c.mrrChf, 650, "mrrChf sums prices, ignoring the prospect's 9999");

console.log("history");
const base = { stars: 2, forks: 1, downloads: { a: 10, b: null }, clients: c, originatorShare: { paid: 0, currency: "BTC", source: "none yet" } };
const r1 = buildReadings({ ...base, date: "2026-09-15", previous: null, generatedAt: "t1" });
eq(r1.history, [{ date: "2026-09-15", stars: 2, forks: 1, downloads: 10, payingClients: 1, mrrChf: 650, originatorSharePaid: 0 }], "first emission writes one history row");
eq(r1.current.downloads.byPackage.b, null, "a package npm could not answer for stays null, not zero");
eq(r1.current.downloads.lastMonth, 10, "the total skips nulls rather than failing");

const r2 = buildReadings({ ...base, date: "2026-09-16", previous: r1, generatedAt: "t2" });
eq(r2.history.length, 1, "an unchanged night adds no row");

const r3 = buildReadings({ ...base, stars: 3, date: "2026-09-17", previous: r2, generatedAt: "t3" });
eq(r3.history.length, 2, "a changed reading adds a row");
eq(r3.history[1].stars, 3, "the new row carries the new value");

const r4 = buildReadings({ ...base, stars: 4, date: "2026-09-17", previous: r3, generatedAt: "t4" });
eq(r4.history.length, 2, "a same-day rerun with a further change replaces the day's row");
eq(r4.history[1].stars, 4, "…with the latest value");

eq(readingsRow(base).downloads, 10, "readingsRow flattens downloads to a total");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
