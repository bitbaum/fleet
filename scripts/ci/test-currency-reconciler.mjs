#!/usr/bin/env node
/**
 * Self-test for currency-reconciler.mjs.
 * Run: node scripts/ci/test-currency-reconciler.mjs
 *
 * No network, no token, no checkout — every decision in that script is pure,
 * which is the reason the acting half lives in the workflow instead.
 *
 * Both sides pinned, per fleet doctrine. The fixtures are the REAL 2026-09-21
 * measurement: ai-kit published at 1.10.0 with eleven of fourteen consumers
 * behind it, ten of them on the same MAJOR — the exact spread
 * `version-currency.mjs` reports as zero gaps, which is why this script exists
 * at all. And the negative half matters as much: a current repo must stay
 * silent, and a range nobody should rewrite must come back untouched.
 */
import {
  parseRange,
  parseVersion,
  compareVersions,
  behind,
  bumpRange,
  internalDepsOf,
  internalDependency,
  npmInternalNames,
  planForManifest,
  byRepo,
  latestOf,
  branchFor,
  MAX_PRS,
  INTERNAL_SCOPE,
} from "./currency-reconciler.mjs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name} ${detail}`);
    failures++;
  }
}

const AI_KIT = "@bitbaum/ai-kit";
const LATEST = { [AI_KIT]: "1.10.0" };

// ── The measurement that motivated the script ────────────────────────────────
// Every one of these is a real range read off origin/main on 2026-09-21.
const FLEET = {
  heidi: "^1.10.0",
  loki: "^1.8.0",
  substrata: "^1.7.0",
  orangecat: "^1.6.0",
  truthseeker: "^1.4.0",
  kivvi: "^0.15.0",
  datacat: "^0.13.0",
};

console.log("currency-reconciler self-test\n");

// ── parsing ──────────────────────────────────────────────────────────────────
check("a caret range parses to its floor", parseRange("^1.4.0")?.minor === 4);
check("a tilde range parses", parseRange("~2.0.1")?.op === "~");
check("an exact pin parses with no operator", parseRange("1.2.3")?.op === "");
check("a version parses", parseVersion("1.10.0")?.minor === 10);
check("a range is not a version", parseVersion("^1.10.0") === null);

// Anything we cannot rewrite mechanically must come back null. The worst bug
// this script could have is silently rewriting a range somebody chose.
for (const weird of [
  "workspace:*",
  "latest",
  "github:bitbaum/ai-kit#v0.6.2",
  "file:../ai-kit",
  ">=1.2.0 <2.0.0",
  "1.x",
  "^1.4",
  "",
  undefined,
]) {
  check(`leaves \`${String(weird)}\` alone`, parseRange(weird) === null);
}

// ── ordering ─────────────────────────────────────────────────────────────────
check("1.4.0 < 1.10.0 — NUMERICALLY, not as strings", compareVersions(parseRange("^1.4.0"), parseVersion("1.10.0")) === -1);
check("1.10.0 == 1.10.0", compareVersions(parseRange("^1.10.0"), parseVersion("1.10.0")) === 0);
check("1.11.0 > 1.10.0 is not behind", behind("^1.11.0", "1.10.0") === null);

// ── the hole this script exists for ──────────────────────────────────────────
// Ten of the eleven behind repos are on major 1. A major-only instrument —
// which is what version-currency.mjs is — reports every one of them as clean.
const sameMajorButBehind = Object.entries(FLEET).filter(
  ([, range]) => parseRange(range).major === 1 && behind(range, LATEST[AI_KIT]),
);
check(
  "catches repos that are behind WITHIN a major (invisible to a major-only audit)",
  sameMajorButBehind.length === 4,
  `saw ${sameMajorButBehind.map(([r]) => r).join(",")}`,
);
check(
  "and heidi, the only current one, is NOT among them",
  !sameMajorButBehind.some(([r]) => r === "heidi"),
);

check("a current repo is silent", behind(FLEET.heidi, LATEST[AI_KIT]) === null);
check("the behind ones are not", behind(FLEET.loki, LATEST[AI_KIT]) !== null);

// ── stranded: the severe case ────────────────────────────────────────────────
// A caret on 0.x pins the MINOR, so `pnpm update` cannot move these at all.
check("^0.15.0 against 1.10.0 is STRANDED", behind(FLEET.kivvi, LATEST[AI_KIT]).stranded === true);
check("^0.13.0 against 1.10.0 is STRANDED", behind(FLEET.datacat, LATEST[AI_KIT]).stranded === true);
check("^1.4.0 against 1.10.0 is behind but NOT stranded", behind(FLEET.truthseeker, LATEST[AI_KIT]).stranded === false);
check("a major crossing is flagged for a reader", behind(FLEET.kivvi, LATEST[AI_KIT]).crossesMajor === true);
check("a minor gap is not flagged as a major crossing", behind(FLEET.loki, LATEST[AI_KIT]).crossesMajor === false);

// ── rewriting ────────────────────────────────────────────────────────────────
check("the caret survives the bump", bumpRange("^1.4.0", "1.10.0") === "^1.10.0");
check("the tilde survives the bump", bumpRange("~1.4.0", "1.10.0") === "~1.10.0");
check("an exact pin stays exact", bumpRange("1.4.0", "1.10.0") === "1.10.0");
check("an unrewritable range is returned UNCHANGED", bumpRange("workspace:*", "1.10.0") === "workspace:*");

// ── scope ────────────────────────────────────────────────────────────────────
// Auto-bumping someone else's major across the fleet is a different risk, and
// our CI is not a safety net for it.
const mixed = {
  dependencies: { [AI_KIT]: "^1.4.0", next: "15.0.0", react: "18.0.0" },
  devDependencies: { "@bitbaum/design-tokens": "^1.0.0", typescript: "^5.0.0" },
};
const internal = internalDepsOf(mixed);
check("picks up @bitbaum/* from dependencies AND devDependencies", Object.keys(internal).length === 2);
check("never touches next", !("next" in internal));
check("never touches react", !("react" in internal));
check("never touches typescript", !("typescript" in internal));
check("the scope is the whole rule", Object.keys(internal).every((n) => n.startsWith(INTERNAL_SCOPE)));

// The curated Fleet register is the authority for additional internal npm
// names. This lets unscoped packages participate without treating arbitrary
// third-party packages as ours; Git-tagged packages remain out of this sweep.
const registeredNames = npmInternalNames({ packages: [
  { name: "bip-kit", version: "0.3.1", install: { source: "npm" } },
  { name: "listkit", version: "0.1.0", install: { source: "git" } },
  { name: "unpublished-kit", install: { source: "npm" } },
] });
check("the register admits a published unscoped npm package", registeredNames.has("bip-kit"));
check("Git-tagged packages stay outside the npm updater", !registeredNames.has("listkit"));
check("unpublished packages without versions stay outside", !registeredNames.has("unpublished-kit"));
check("ordinary third-party packages stay outside", !registeredNames.has("react"));
check("recognises a registered unscoped dependency", internalDependency("bip-kit", "^0.2.7", registeredNames)?.packageName === "bip-kit");
check("recognises an npm alias to an internal unscoped package", internalDependency("studio-bip", "npm:bip-kit@^0.2.7", registeredNames)?.packageName === "bip-kit");
check("preserves an alias whose target is a scoped internal package", internalDependency("model-kit", "npm:@bitbaum/ai-kit@^1.9.0", registeredNames)?.packageName === AI_KIT);
check("does not treat an alias to a third-party npm package as internal", internalDependency("other", "npm:react@^18.0.0", registeredNames) === null);

// ── planning ─────────────────────────────────────────────────────────────────
const plan = planForManifest("loki", "package.json", mixed, {
  ...LATEST,
  "@bitbaum/design-tokens": "1.0.0",
});
check("plans only what is actually behind", plan.length === 1 && plan[0].name === AI_KIT);
check("a current internal dep produces no row", !plan.some((r) => r.name === "@bitbaum/design-tokens"));

const unpublished = planForManifest("x", "package.json", { dependencies: { "@bitbaum/nope": "^1.0.0" } }, {});
check("a package npm could not be asked about is SKIPPED, never bumped to nothing", unpublished.length === 0);

const broaderPlan = planForManifest("x", "package.json", {
  dependencies: { "bip-kit": "^0.2.7", "studio-bip": "npm:bip-kit@^0.2.7", react: "^18.0.0" },
}, { "bip-kit": "0.3.1" }, registeredNames);
check("plans the registered unscoped package and the npm alias only", broaderPlan.length === 2);
check("bumps a direct unscoped package floor", broaderPlan.find((r) => r.name === "bip-kit")?.to === "^0.3.1");
check("bumps the target range while preserving the npm alias", broaderPlan.find((r) => r.name === "studio-bip")?.to === "npm:bip-kit@^0.3.1");
check("the plan keeps manifest key and canonical package identity separate", broaderPlan.find((r) => r.name === "studio-bip")?.packageName === "bip-kit");

// A monorepo consumer must be seen. kivvi and datacat install in packages/ai
// and backend/, and being invisible there is how they stayed on 0.x.
const sub = planForManifest("kivvi", "packages/ai/package.json", { dependencies: { [AI_KIT]: "^0.15.0" } }, LATEST);
check("a non-root manifest is planned and keeps its path", sub[0]?.path === "packages/ai/package.json");

// ── grouping ─────────────────────────────────────────────────────────────────
const grouped = byRepo([
  { repo: "kivvi", path: "packages/ai/package.json", name: AI_KIT },
  { repo: "kivvi", path: "package.json", name: AI_KIT },
  { repo: "datacat", path: "backend/package.json", name: AI_KIT },
]);
check("one entry per repo, however many manifests", grouped.length === 2);
check("both of kivvi's manifests ride one entry", grouped.find((g) => g.repo === "kivvi").bumps.length === 2);
check("sorted, so the plan reads the same twice", grouped[0].repo === "datacat");

// ── one branch, forever ──────────────────────────────────────────────────────
check("the branch name is stable across runs", branchFor() === branchFor());
check("the branch name is not dated", !/\d{4}/.test(branchFor()));

// ── npm, faked ───────────────────────────────────────────────────────────────
check("reads a version from npm", latestOf(AI_KIT, { run: () => "1.10.0\n" }) === "1.10.0");
check("npm failing is null, never a bump", latestOf(AI_KIT, { run: () => { throw new Error("offline"); } }) === null);
check("npm answering garbage is null, never a bump", latestOf(AI_KIT, { run: () => "not-a-version" }) === null);

// ── the cap ──────────────────────────────────────────────────────────────────
check("the cap is small enough to be a real guard", MAX_PRS > 0 && MAX_PRS <= 25);
// The cap must clear the fleet's REAL size or it fires on every correct run,
// which is how a guard gets raised unread. 13 is what the first live run
// counted across 43 repos on 2026-09-21; 12 was set from a miscount and
// tripped immediately.
check("the cap clears the 13 the first live run actually found", MAX_PRS >= 13);
check("but still refuses a whole-fleet sweep (43 repos)", MAX_PRS < 43);

console.log();
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("all checks passed");
