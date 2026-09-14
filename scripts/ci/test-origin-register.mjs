#!/usr/bin/env node
/**
 * Self-test for origin-register.mjs. No network, no gh, no ots.
 *
 * The register is read by a page that says "proven since <date>" about real
 * work, so the assertions are about what it must NOT claim: a private repo is
 * not listed, a pending proof is not "anchored", provenSince is the OLDEST
 * anchored manifest and not the newest one, and a repo the proofs never saw
 * has no stamp at all rather than someone else's.
 */

import { buildRegister, parseAnchoredBlock, readManifests } from "./origin-register.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ""}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));

const repos = [
  { name: "pubkit", url: "https://github.com/bitbaum/pubkit", description: "a kit", createdAt: "2026-01-01T00:00:00Z", visibility: "PUBLIC", isFork: false },
  { name: "newkit", url: "https://github.com/bitbaum/newkit", description: null, createdAt: "2026-03-01T00:00:00Z", visibility: "PUBLIC", isFork: false },
  { name: "secret", url: "https://github.com/bitbaum/secret", description: "x", createdAt: "2026-01-01T00:00:00Z", visibility: "PRIVATE", isFork: false },
  { name: "openclaw", url: "https://github.com/bitbaum/openclaw", description: "fork", createdAt: "2026-01-01T00:00:00Z", visibility: "PUBLIC", isFork: true },
];
const firstCommits = { pubkit: { sha: "f1", date: "2026-01-01T01:00:00Z", count: 40 }, newkit: { sha: "n1", date: "2026-03-01T01:00:00Z", count: 2 } };
const manifests = [
  { file: "2026-02-01T000000Z.json", generatedAt: "2026-02-01T00:00:00Z", anchored: 900001, repos: [{ repo: "bitbaum/pubkit", head: "aaa" }] },
  { file: "2026-02-15T000000Z.json", generatedAt: "2026-02-15T00:00:00Z", anchored: 900500, repos: [{ repo: "bitbaum/pubkit", head: "bbb" }] },
  { file: "2026-03-02T000000Z.json", generatedAt: "2026-03-02T00:00:00Z", anchored: null, repos: [{ repo: "bitbaum/pubkit", head: "ccc" }, { repo: "bitbaum/newkit", head: "n2" }] },
];
const swh = { pubkit: { snapshot: "abc123", date: "2026-02-02T00:00:00Z" }, newkit: null };

console.log("origin register");
const reg = buildRegister({ repos, firstCommits, manifests, swh, generatedAt: "2026-03-03T00:00:00Z" });

eq(reg.repos.map((r) => r.repo), ["bitbaum/newkit", "bitbaum/pubkit"], "lists public non-fork repos only, sorted");
eq(reg.privateRepos, 1, "counts the private repo instead of naming it");
eq(JSON.stringify(reg).includes("secret"), false, "the private repo's name appears nowhere");

const pk = reg.repos.find((r) => r.repo === "bitbaum/pubkit");
eq(pk.stamped, { head: "ccc", at: "2026-03-02T00:00:00Z", manifest: "2026-03-02T000000Z.json", anchored: null }, "stamped is the newest manifest, and a pending proof is anchored: null");
eq(pk.provenSince, { at: "2026-02-01T00:00:00Z", block: 900001, manifest: "2026-02-01T000000Z.json" }, "provenSince is the OLDEST anchored manifest, not the newest");
eq(pk.firstStampedAt, "2026-02-01T00:00:00Z", "firstStampedAt is the first manifest naming the repo");
eq(pk.firstCommit, { sha: "f1", date: "2026-01-01T01:00:00Z" }, "firstCommit is carried through");
eq(pk.commits, 40, "commit count is carried through");
eq(pk.swh.snapshot, "swh:1:snp:abc123", "SWH snapshot is written as a SWHID");

const nk = reg.repos.find((r) => r.repo === "bitbaum/newkit");
eq(nk.provenSince, null, "a repo whose only manifest is pending is not 'proven'");
eq(nk.stamped.head, "n2", "a repo stamped once still shows its stamp");
eq(nk.swh, null, "no SWH visit means null, not a made-up link");

eq(reg.proofs, {
  manifests: 3, firstStampedAt: "2026-02-01T00:00:00Z", latestStampedAt: "2026-03-02T00:00:00Z", anchored: 2, pending: 1,
  dir: "https://github.com/bitbaum/fleet/tree/main/proofs/origin",
}, "proof summary counts anchored and pending manifests");

const none = buildRegister({ repos, firstCommits: {}, manifests: [], swh: {}, generatedAt: "x" });
eq(none.repos.find((r) => r.repo === "bitbaum/pubkit").stamped, null, "with no manifests, stamped is null rather than invented");
eq(none.proofs.firstStampedAt, null, "with no manifests the summary says so");

console.log("ots info parsing");
eq(parseAnchoredBlock("Timestamp:\n  verify BitcoinBlockHeaderAttestation(912345)\n"), 912345, "reads the block number");
eq(parseAnchoredBlock("Timestamp:\n  verify PendingAttestation('https://a.pool')\n"), null, "a pending attestation is null");
eq(parseAnchoredBlock(""), null, "empty output is null");

console.log("reading a proof directory");
const dir = mkdtempSync(join(tmpdir(), "origin-reg-"));
writeFileSync(join(dir, "2026-01-01T000000Z.json"), JSON.stringify({ generatedAt: "2026-01-01T00:00:00Z", repos: [{ repo: "bitbaum/a", head: "1" }, { repoSha256: "deadbeef", head: "2" }] }));
writeFileSync(join(dir, "2026-01-02T000000Z.json"), JSON.stringify({ generatedAt: "2026-01-02T00:00:00Z", repos: [{ repo: "bitbaum/a", head: "3" }] }));
const read = readManifests(dir, (p) => (p.endsWith("2026-01-01T000000Z.json.ots") ? 5 : null));
eq(read.map((m) => m.file), ["2026-01-01T000000Z.json", "2026-01-02T000000Z.json"], "manifests are read in name order");
eq(read[0].repos, [{ repo: "bitbaum/a", head: "1" }], "hashed private rows are dropped on read");
eq(read.map((m) => m.anchored), [5, null], "anchoring is asked per proof file");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
