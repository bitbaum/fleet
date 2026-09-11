#!/usr/bin/env node
// Tests for the repo-metadata audit.
//
// The judgement is a pure function of (repos, register, allow), so every case
// here runs with no network and no checkout — the fixtures ARE the shapes that
// were live on 2026-09-11, including the two that are correct-but-look-wrong.
//
// Both directions, always: a clean fleet must pass, and each defect must fail
// AND be named. An audit that cannot go red is decoration.
//
// Run: node scripts/ci/test-repo-metadata-audit.mjs
import { judge, parseRegister, parseAllow } from "./repo-metadata-audit.mjs";

let pass = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const is = (a, b, m) => (a === b ? ok(m) : fail(`${m} (want ${JSON.stringify(b)}, got ${JSON.stringify(a)})`));

// A register line is 12 pipe-separated fields; the repo is the LAST SEGMENT of
// the path, because the row is keyed by deploy name and those differ.
const CONF = [
  "# comment line, ignored",
  "aoz-wohnen|4008|aoz.orangecat.ch|/home/g/dev/aoz-housing|.|aoz_wohnen|AOZ|client-app|live|favour|0|2026-08-13",
  "revamp-info|4012|revamp-info.orangecat.ch|/home/g/dev/hirnli|.|hirnli|bitbaum|product|live|-|-|-",
  "internal|4099|-|/home/g/dev/internal|.|-|bitbaum|infra|live|-|-|-",
].join("\n");

console.log("repo metadata vs the register");

const reg = parseRegister(CONF);
is(reg.size, 2, "rows with a real domain are registered; a '-' domain is not");
is(reg.get("aoz-housing")?.domain, "aoz.orangecat.ch", "the row is keyed by REPO, not by deploy name");
is(reg.get("hirnli")?.name, "revamp-info", "and it remembers the deploy name it came from");

const allow = parseAllow("# c\nhirnli|homepage|its own platform host\n\nbad-line-no-pipe\n");
is(allow.size, 1, "the allowlist ignores comments, blanks and malformed lines");

// --- the clean fleet ---------------------------------------------------------
const clean = [
  { name: "aoz-housing", archived: false, homepage: "https://aoz.orangecat.ch", description: "AOZ Begleitung" },
  { name: "hirnli", archived: false, homepage: "https://hirnli.orangecat.ch", description: "Hirnli" },
  { name: "ai-kit", archived: false, homepage: "", description: "the AI layer" },
];
is(judge({ repos: clean, register: reg, allow }).length, 0,
   "a fleet where every registered homepage matches passes");
ok("an UNREGISTERED repo with no homepage is fine — most packages have no door");

// --- the shape that was live: registered, no homepage ------------------------
const missing = [{ name: "aoz-housing", archived: false, homepage: "", description: "x" }];
const f1 = judge({ repos: missing, register: reg, allow });
is(f1.length, 1, "a registered app with no homepage is a finding");
is(f1[0].kind, "homepage", "...classified as a homepage finding");
is(f1[0].detail.includes("aoz.orangecat.ch"), true, "...and it names the host the register knows");

// --- evig's exact shape: a homepage that is the WRONG domain -----------------
const wrong = [{ name: "aoz-housing", archived: false, homepage: "https://example.com", description: "x" }];
const f2 = judge({ repos: wrong, register: reg, allow });
is(f2.length, 1, "a homepage pointing somewhere else is a finding (evig's shape)");
is(f2[0].detail.includes("not the registered host"), true, "...and says so plainly");

// --- the allowlist is a decision, and it is SCOPED ---------------------------
const hirnliWrong = [{ name: "hirnli", archived: false, homepage: "https://hirnli.orangecat.ch", description: "x" }];
is(judge({ repos: hirnliWrong, register: reg, allow }).length, 0,
   "an allowed repo may point at its own host (hirnli: platform vs tenant row)");
const hirnliNoDesc = [{ name: "hirnli", archived: false, homepage: "https://hirnli.orangecat.ch", description: "" }];
is(judge({ repos: hirnliNoDesc, register: reg, allow }).length, 1,
   "but a homepage exception does NOT excuse a missing description");

// --- description ------------------------------------------------------------
const noDesc = [{ name: "ai-kit", archived: false, homepage: "", description: "   " }];
const f3 = judge({ repos: noDesc, register: reg, allow });
is(f3.length, 1, "whitespace is not a description");
is(f3[0].kind, "description", "...classified as a description finding");

// --- archived repos are history, not drift -----------------------------------
const archived = [{ name: "aoz-housing", archived: true, homepage: "", description: "" }];
is(judge({ repos: archived, register: reg, allow }).length, 0,
   "an archived repo is exempt — it is a record, not a live claim");

// --- missing fields must not crash or pass vacuously -------------------------
const sparse = [{ name: "aoz-housing", archived: false }];
is(judge({ repos: sparse, register: reg, allow }).length, 2,
   "absent homepage and description are findings, not undefined-shaped silence");

console.log(`  ${pass} passed`);
