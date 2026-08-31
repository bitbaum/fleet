#!/usr/bin/env node
/**
 * Self-test for version-currency.mjs.
 * Run: node scripts/ci/test-version-currency.mjs
 *
 * Both sides pinned, per fleet doctrine: the real 2026-08-31 staleness is
 * still caught (positive), a fully-current manifest stays silent (negative),
 * and an unreadable repo is UNCHECKED — never counted as gap-free. The
 * fixtures are the audit that motivated the ratchet: aoz-housing's actual
 * manifest shape, including the dead-owner ai-kit pin.
 */
import { parseMajor, parseGitPin, gapsFor, collate } from "./version-currency.mjs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
}

const blessed = {
  majors: { next: 16, react: 19, tailwindcss: 4, zod: 4, eslint: 10, "@types/node": 26 },
  internal_tags: { "ai-kit": "v0.6.2" },
};

// ── parseMajor / parseGitPin ────────────────────────────────────────────────
check("parseMajor ^16.2.3 -> 16", parseMajor("^16.2.3") === 16);
check("parseMajor '*' -> null", parseMajor("*") === null);
check("parseGitPin github:catomean/ai-kit#v0.4.0",
  JSON.stringify(parseGitPin("github:catomean/ai-kit#v0.4.0")) ===
  JSON.stringify({ owner: "catomean", repo: "ai-kit", tag: "v0.4.0" }));
check("parseGitPin registry range -> null", parseGitPin("^4.5.4") === null);

// ── Positive: the aoz-housing regression is caught ──────────────────────────
const stale = {
  dependencies: { next: "^14.2.5", react: "^18.3.1", "ai-kit": "github:catomean/ai-kit#v0.4.0" },
  devDependencies: { tailwindcss: "^3.4.9", zod: "^3.23.8", eslint: "^8.57.0", "@types/node": "^20.14.10" },
};
const staleGaps = gapsFor(stale, blessed);
check("stale manifest: 6 major gaps + 1 pin gap", staleGaps.length === 7, `got ${JSON.stringify(staleGaps)}`);
check("dead-owner pin is named as such", staleGaps.some((g) => g.includes("dead after org move")));
check("next gap present", staleGaps.some((g) => g.startsWith("next ")));

// ── Negative: a current manifest stays silent ───────────────────────────────
const current = {
  dependencies: { next: "16.3.3", react: "^19.2.8", "ai-kit": "github:bitbaum/ai-kit#v0.6.2" },
  devDependencies: { tailwindcss: "^4.3.3", zod: "^4.5.4", eslint: "^10.9.1", "@types/node": "^26.4.0" },
};
check("current manifest: zero gaps", gapsFor(current, blessed).length === 0,
  `got ${JSON.stringify(gapsFor(current, blessed))}`);

// ── Packages the repo does not use are not gaps ─────────────────────────────
check("absent package is not a gap", gapsFor({ dependencies: {} }, blessed).length === 0);

// ── Right-tag wrong-owner and right-owner wrong-tag both flagged ────────────
check("stale bitbaum tag flagged",
  gapsFor({ dependencies: { "ai-kit": "github:bitbaum/ai-kit#v0.5.0" } }, blessed).length === 1);

// ── UNCHECKED is not clean ──────────────────────────────────────────────────
const { rows, total, uncheckedRepos } = collate([
  { repo: "good", pkg: current, gaps: gapsFor(current, blessed) },
  { repo: "bad", pkg: stale, gaps: staleGaps },
  { repo: "unreadable" }, // no pkg — could not fetch
]);
check("unreadable repo lands in UNCHECKED", uncheckedRepos.length === 1 && uncheckedRepos[0] === "unreadable");
check("unreadable repo not in measured rows", rows.every((r) => r.repo !== "unreadable"));
check("total counts only measured gaps", total === 7);
check("worst repo sorts first", rows[0].repo === "bad");

// ── Mutation-proof: a lowered baseline must trip the ratchet ────────────────
// (The ratchet math is `total > baseline` in main(); assert the collate side
// that feeds it — a stale fleet yields a total a clean baseline cannot cover.)
check("mutation: stale total exceeds a clean baseline", total > 0);

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
