#!/usr/bin/env node
/**
 * origin-register.mjs — registers/origin.json: what can be shown about when
 * each public repository came to exist, from clocks we do not control.
 *
 * proofs/origin/ holds the evidence (OpenTimestamps manifests, one per night
 * something moved) but nobody can read a .ots file. This joins that evidence
 * with GitHub's own first-commit date and Software Heritage's archive into one
 * row per repository, so bitbaum.orangecat.ch can render "since <date>,
 * stamped in Bitcoin block N, archived by SWH" without typing any of it.
 *
 * Three clocks, in rising strength:
 *   createdAt / firstCommit  GitHub's server-side dates. Not editable by us,
 *                            but GitHub's word.
 *   swh                      Software Heritage's ingestion date and snapshot
 *                            id — an independent archive's word.
 *   stamped                  the OpenTimestamps proof: the manifest naming
 *                            this HEAD is committed in a Bitcoin block. Nobody's
 *                            word; arithmetic.
 *
 * Private repositories are not listed: an origin claim is for what is public.
 * Their count is reported so the omission is visible.
 *
 *   node scripts/ci/origin-register.mjs --emit registers/origin.json
 *
 * generatedAt means "when these facts last changed", not "when this ran" —
 * same rule as packages.json — so a quiet night produces no diff and no commit.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORG = process.env.ORG || "bitbaum";
const PROOF_DIR = process.env.PROOF_DIR || "proofs/origin";
const SWH_API = process.env.SWH_API || "https://archive.softwareheritage.org/api/1";

// ── pure: evidence in, register out ─────────────────────────────────────────

/**
 * @param repos       [{name, url, description, createdAt, visibility, isFork}]
 * @param firstCommits {name: {sha, date, count}}
 * @param manifests   [{file, generatedAt, repos:[{repo, head, committedAt}], anchored: number|null}]
 * @param swh         {name: {snapshot, date}|null}
 */
export function buildRegister({ repos, firstCommits, manifests, swh, generatedAt }) {
  const ordered = [...manifests].sort((a, b) => a.file.localeCompare(b.file));
  const rows = repos
    .filter((r) => !r.isFork && r.visibility === "PUBLIC")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      const full = `${ORG}/${r.name}`;
      const inManifests = ordered.filter((m) => m.repos.some((x) => x.repo === full));
      const first = inManifests[0];
      const latest = inManifests[inManifests.length - 1];
      // The strongest claim is the OLDEST anchored manifest naming this repo:
      // it proves the repo existed at that block, whatever moved since.
      const oldestAnchored = inManifests.find((m) => m.anchored != null);
      const fc = firstCommits[r.name];
      const row = {
        repo: full,
        url: r.url,
        description: r.description || null,
        createdAt: r.createdAt,
        firstCommit: fc ? { sha: fc.sha, date: fc.date } : null,
        commits: fc?.count ?? null,
        stamped: latest
          ? {
              head: latest.repos.find((x) => x.repo === full).head,
              at: latest.generatedAt,
              manifest: latest.file,
              anchored: latest.anchored ?? null,
            }
          : null,
        firstStampedAt: first?.generatedAt ?? null,
        provenSince: oldestAnchored
          ? { at: oldestAnchored.generatedAt, block: oldestAnchored.anchored, manifest: oldestAnchored.file }
          : null,
        swh: swh[r.name]
          ? {
              snapshot: `swh:1:snp:${swh[r.name].snapshot}`,
              date: swh[r.name].date,
              url: `https://archive.softwareheritage.org/browse/origin/directory/?origin_url=${encodeURIComponent(`https://github.com/${full}`)}`,
            }
          : null,
      };
      return row;
    });
  const privateCount = repos.filter((r) => !r.isFork && r.visibility === "PRIVATE").length;
  return {
    generatedAt,
    org: ORG,
    proofs: {
      manifests: ordered.length,
      firstStampedAt: ordered[0]?.generatedAt ?? null,
      latestStampedAt: ordered[ordered.length - 1]?.generatedAt ?? null,
      anchored: ordered.filter((m) => m.anchored != null).length,
      pending: ordered.filter((m) => m.anchored == null).length,
      dir: `https://github.com/${ORG}/fleet/tree/main/${PROOF_DIR}`,
    },
    privateRepos: privateCount,
    repos: rows,
    _notes: [
      "One row per public, non-fork repository. Private repositories are counted, not listed.",
      "createdAt and firstCommit are GitHub's server-side dates. swh is Software Heritage's own visit date and snapshot. stamped is the newest OpenTimestamps manifest naming this HEAD; anchored is the Bitcoin block it is committed in, or null while the calendar's promise is still pending.",
      "provenSince is the oldest anchored manifest naming the repository: the strongest claim, independent of what moved since.",
      "Derived by fleet/scripts/ci/origin-register.mjs from proofs/origin, the GitHub API and the Software Heritage API. Nobody types this file.",
    ],
  };
}

/** Read every manifest in PROOF_DIR with its proof's anchoring state. */
export function readManifests(dir, anchoredBlock = anchoredBlockOf) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const m = JSON.parse(readFileSync(join(dir, file), "utf8"));
      return {
        file,
        generatedAt: m.generatedAt,
        repos: (m.repos || []).filter((r) => r.repo),
        anchored: anchoredBlock(join(dir, `${file}.ots`)),
      };
    });
}

/** Bitcoin block number from `ots info`, or null when pending / unreadable. */
export function parseAnchoredBlock(otsInfoOutput) {
  const m = /BitcoinBlockHeaderAttestation\((\d+)\)/.exec(otsInfoOutput || "");
  return m ? Number(m[1]) : null;
}

function anchoredBlockOf(otsPath) {
  if (!existsSync(otsPath)) return null;
  try {
    return parseAnchoredBlock(execFileSync("ots", ["info", otsPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

// ── the live sources ────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function listRepos() {
  return JSON.parse(
    gh(["repo", "list", ORG, "--limit", "500", "--json", "name,url,description,createdAt,visibility,isFork,defaultBranchRef"]),
  ).filter((r) => r.defaultBranchRef);
}

// One GraphQL round-trip for every repo's HEAD and commit count, a second for
// the first commit via GitHub's "<head> <n>" history cursor. Two calls, not
// ninety.
function firstCommitsOf(repos) {
  const alias = (r) => "r" + r.name.replace(/[^A-Za-z0-9]/g, "_");
  const q1 = `{ ${repos
    .map((r) => `${alias(r)}: repository(owner:"${ORG}", name:"${r.name}") { defaultBranchRef { target { ... on Commit { oid history(first:1) { totalCount } } } } }`)
    .join(" ")} }`;
  const d1 = JSON.parse(gh(["api", "graphql", "-f", `query=${q1}`])).data;
  const heads = {};
  for (const r of repos) {
    const t = d1[alias(r)]?.defaultBranchRef?.target;
    if (t) heads[r.name] = { oid: t.oid, count: t.history.totalCount };
  }
  const q2 = `{ ${repos
    .filter((r) => heads[r.name])
    .map((r) => {
      const h = heads[r.name];
      const after = h.count > 1 ? `, after:"${h.oid} ${h.count - 2}"` : "";
      return `${alias(r)}: repository(owner:"${ORG}", name:"${r.name}") { defaultBranchRef { target { ... on Commit { history(first:1${after}) { nodes { oid committedDate } } } } } }`;
    })
    .join(" ")} }`;
  const d2 = JSON.parse(gh(["api", "graphql", "-f", `query=${q2}`])).data;
  const out = {};
  for (const r of repos) {
    const node = d2[alias(r)]?.defaultBranchRef?.target?.history?.nodes?.[0];
    if (node && heads[r.name]) out[r.name] = { sha: node.oid, date: node.committedDate, count: heads[r.name].count };
  }
  return out;
}

async function swhOf(repos) {
  const out = {};
  for (const r of repos) {
    const url = `${SWH_API}/origin/${encodeURIComponent(`https://github.com/${ORG}/${r.name}`)}/visit/latest/?require_snapshot=true`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) { out[r.name] = null; continue; }
      const v = await res.json();
      out[r.name] = v.snapshot ? { snapshot: v.snapshot, date: v.date } : null;
    } catch {
      out[r.name] = null;
    }
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const emitIdx = process.argv.indexOf("--emit");
  const out = emitIdx >= 0 ? process.argv[emitIdx + 1] : null;
  if (emitIdx >= 0 && !out) { console.error("--emit needs a path"); process.exit(2); }

  const repos = listRepos();
  const pub = repos.filter((r) => !r.isFork && r.visibility === "PUBLIC");
  if (pub.length === 0) { console.error(`no public repos listed for ${ORG} — a token problem, not an empty org`); process.exit(1); }
  const firstCommits = firstCommitsOf(pub);
  const manifests = readManifests(PROOF_DIR);
  const swh = await swhOf(pub);
  const payload = buildRegister({ repos, firstCommits, manifests, swh, generatedAt: new Date().toISOString() });

  const withSwh = payload.repos.filter((r) => r.swh).length;
  const proven = payload.repos.filter((r) => r.provenSince).length;
  console.log(
    `origin register: ${payload.repos.length} public repos (${payload.privateRepos} private counted), ` +
      `${payload.proofs.manifests} manifests (${payload.proofs.anchored} anchored, ${payload.proofs.pending} pending), ` +
      `${proven} repos proven in Bitcoin, ${withSwh} archived by Software Heritage`,
  );

  if (out) {
    const body = JSON.stringify({ ...payload, generatedAt: null });
    if (existsSync(out)) {
      try {
        const prev = JSON.parse(readFileSync(out, "utf8"));
        if (JSON.stringify({ ...prev, generatedAt: null }) === body) payload.generatedAt = prev.generatedAt;
      } catch { /* unreadable previous file: write fresh */ }
    }
    writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
    console.log(`wrote ${out}`);
  }
}
