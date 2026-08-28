#!/usr/bin/env node
/**
 * Self-test for model-pin-audit.mjs.
 * Run: node scripts/ci/test-model-pin-audit.mjs
 *
 * A detector that has quietly stopped detecting reports a clean fleet, and a
 * clean report from a broken detector is worse than no report — it is an absent
 * check that prints a ✓. So every fixture asserts a VERDICT, and both sides are
 * pinned:
 *
 *   - the real AOZ regression is still caught      (positive)
 *   - the corrected file stays silent              (negative)
 *   - quoted things that are not model ids stay out of the report
 *   - an unreadable catalogue reports UNCHECKED, never GONE
 *
 * That last one is the expensive mistake. Treating "I could not look" as
 * "nothing is there" marks every pin retired and invents a fleet-wide outage
 * that somebody will act on. Silence is recoverable; a false alarm at this
 * scale is not.
 *
 * Fixtures are inline strings — no network, no gh, no checkout, no key.
 */
import {
  extractPins,
  attribute,
  collate,
  judge,
  looksLikeModelId,
  possibleAt,
  isLikelyPath,
  isPossiblePath,
  isCandidatePath,
  segmentNamesAI,
  modelListRegions,
} from "./model-pin-audit.mjs";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
    failures++;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** aoz-housing/src/lib/env.ts as it stood when both AI surfaces went down. */
const AOZ_BROKEN = `
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  CRON_SECRET: z.string().min(16).optional(),

  // AI: whichever key is set decides the provider.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('openai/gpt-oss-20b:free'),
})
`;

/** The same file after the fix. Must produce no findings at all. */
const AOZ_FIXED = AOZ_BROKEN.replace("llama-3.3-70b-versatile", "openai/gpt-oss-120b");

/** aoz-housing/src/lib/ai/provider.ts — one module, BOTH vendors named. */
const TWO_VENDOR_FILE = `
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

export async function getConfig() {
  if (provider === 'groq') {
    return { url: GROQ_API_URL, model: 'llama-3.1-8b-instant' }
  }
  return { url: OPENROUTER_API_URL, model: 'meta-llama/llama-3.3-70b-instruct:free' }
}
`;

/** Quoted strings that must never be mistaken for model ids. */
const NOISE = `
import { BRAND } from '@/lib/config/brand'
const path = './lib/ai/provider.ts'
const url = 'https://api.groq.com/openai/v1/chat/completions'
const key = 'GROQ_API_KEY'
const model = 'llama-3.1-8b-instant'
const style = 'rounded-lg'
`;

// ── looksLikeModelId ─────────────────────────────────────────────────────────

console.log("looksLikeModelId");
check("accepts a versioned id", looksLikeModelId("llama-3.3-70b-versatile"), true);
check("accepts a routed id", looksLikeModelId("openai/gpt-oss-20b:free"), true);
check("rejects a relative path", looksLikeModelId("./lib/ai/provider.ts"), false);
check("rejects a url", looksLikeModelId("https://api.groq.com/openai/v1"), false);
check("rejects an env var name", looksLikeModelId("GROQ_API_KEY"), false);
check("rejects a css class", looksLikeModelId("rounded-lg"), false);
check("rejects a module specifier", looksLikeModelId("@/lib/config/brand"), false);
// fleetcrown builds its model id from ai-ration's chain at call time. A
// computed id is the ABSENCE of a pin, and the first run reported it retired.
check("rejects an interpolated id", looksLikeModelId("${link.provider.id}/${link.model}"), false);

// ── extraction ───────────────────────────────────────────────────────────────

console.log("\nextractPins");
check(
  "finds both pins in the broken AOZ env schema",
  extractPins(AOZ_BROKEN).map((p) => p.id).sort(),
  ["llama-3.3-70b-versatile", "openai/gpt-oss-20b:free"],
);
check(
  "finds the model literals in a two-vendor provider",
  extractPins(TWO_VENDOR_FILE).map((p) => p.id).sort(),
  ["llama-3.1-8b-instant", "meta-llama/llama-3.3-70b-instruct:free"],
);
check(
  "picks the model id out of a file full of other quoted strings",
  extractPins(NOISE).map((p) => p.id),
  ["llama-3.1-8b-instant"],
);

// ── attribution ──────────────────────────────────────────────────────────────

console.log("\nattribute");
{
  const pins = extractPins(AOZ_BROKEN);
  const groq = pins.find((p) => p.id === "llama-3.3-70b-versatile");
  const or = pins.find((p) => p.id === "openai/gpt-oss-20b:free");
  check("GROQ_MODEL line attributes to groq", attribute(AOZ_BROKEN, groq.line), "groq");
  check("OPENROUTER_MODEL line attributes to openrouter", attribute(AOZ_BROKEN, or.line), "openrouter");
}
{
  // The case a file-wide vote gets wrong: both vendors named in one module, so
  // only the pin's own neighbourhood says which branch it belongs to.
  const pins = extractPins(TWO_VENDOR_FILE);
  const g = pins.find((p) => p.id === "llama-3.1-8b-instant");
  const o = pins.find((p) => p.id === "meta-llama/llama-3.3-70b-instruct:free");
  check("nearest marker wins for the groq branch", attribute(TWO_VENDOR_FILE, g.line), "groq");
  check("nearest marker wins for the openrouter branch", attribute(TWO_VENDOR_FILE, o.line), "openrouter");
}
check(
  "a pin with no vendor anywhere is not attributed",
  attribute("const model = 'some-model-9b'", 1),
  null,
);

// ── judging ──────────────────────────────────────────────────────────────────

console.log("\njudge");
const findingsFrom = (repo, path, text) =>
  extractPins(text).map((p) => ({
    repo,
    path,
    line: p.line,
    id: p.id,
    vendor: attribute(text, p.line),
  }));

const GROQ_LIVE = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
const OR_LIVE = new Set(["openai/gpt-oss-20b:free"]);

{
  const findings = findingsFrom("aoz-housing", "src/lib/env.ts", AOZ_BROKEN);
  const live = new Map([["groq", GROQ_LIVE], ["openrouter", OR_LIVE]]);
  const judged = judge(findings, live);

  check(
    "THE REGRESSION: the retired llama pin is caught",
    judged.filter((j) => j.state === "gone").map((j) => j.id),
    ["llama-3.3-70b-versatile"],
  );
  check(
    "the still-served openrouter pin beside it stays quiet",
    judged.filter((j) => j.state === "ok").map((j) => j.id),
    ["openai/gpt-oss-20b:free"],
  );
}

{
  // The negative that matters most: correct code must produce a silent report,
  // or the audit trains people to ignore it.
  const findings = findingsFrom("aoz-housing", "src/lib/env.ts", AOZ_FIXED);
  const live = new Map([["groq", GROQ_LIVE], ["openrouter", OR_LIVE]]);
  const judged = judge(findings, live);
  check("the FIXED file reports nothing retired", judged.filter((j) => j.state === "gone"), []);
  check("and confirms both pins live", judged.filter((j) => j.state === "ok").length, 2);
}

{
  // An unreadable catalogue must never read as rot. This is the guard against
  // a missing key printing a fleet-wide outage that somebody then acts on.
  const findings = findingsFrom("aoz-housing", "src/lib/env.ts", AOZ_BROKEN);
  const live = new Map([["groq", null], ["openrouter", null]]);
  const judged = judge(findings, live);
  check("no key => UNCHECKED, never GONE", judged.filter((j) => j.state === "gone"), []);
  check("and every pin is reported unchecked", judged.filter((j) => j.state === "unchecked").length, 2);
}

{
  const findings = [{ repo: "x", path: "y", line: 1, id: "some-model-9b", vendor: null }];
  const judged = judge(findings, new Map());
  check("an unattributed pin is listed, not judged", judged[0].state, "unattributed");
}

// ── collate ──────────────────────────────────────────────────────────────────

console.log("\ncollate");
{
  const findings = [
    ...findingsFrom("a", "env.ts", AOZ_BROKEN),
    { repo: "b", path: "c.ts", line: 1, id: "mystery-1b", vendor: null },
  ];
  const { byVendor, unattributed } = collate(findings);
  check("groups by vendor", [...byVendor.keys()].sort(), ["groq", "openrouter"]);
  check("keeps the unattributable aside", unattributed.map((u) => u.id), ["mystery-1b"]);
}

// ── vendor confusion ─────────────────────────────────────────────────────────
//
// Found by running the audit for the first time, so it is pinned here.
//
// kivvi/apps/web/lib/ai/call-provider.ts dispatches four vendors in one
// function. `grok-3-mini` is xAI's model; Groq is a different company whose
// name differs by one letter, and whose base URL sat 18 lines above the pin
// while xAI's sat 6 above. Ranking by raw proximity called a live xAI model a
// retired Groq one — and the Groq pin six lines up tied EXACTLY between the two
// vendors, so a tie-break by proximity alone lost a true positive as well.
//
// Both halves are asserted: the xAI id must not be judged against Groq's
// catalogue, and the real Groq pin must still be caught.
const KIVVI_MULTI_VENDOR = `
export async function callProvider(provider, apiKey, systemPrompt, userText, maxTokens) {
  let url;
  let headers;
  let body;

  if (provider === "groq") {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = { Authorization: \`Bearer \${apiKey}\` };
    body = {
      model: "llama-3.1-8b-instant",
      messages: openaiMessages,
    };
  } else if (provider === "xai") {
    url = "https://api.x.ai/v1/chat/completions";
    headers = { Authorization: \`Bearer \${apiKey}\` };
    body = {
      model: "grok-3-mini",
      messages: openaiMessages,
    };
  }
}
`;

console.log("\nvendor confusion (regression)");
{
  const pins = extractPins(KIVVI_MULTI_VENDOR);
  const groqPin = pins.find((p) => p.id === "llama-3.1-8b-instant");
  const xaiPin = pins.find((p) => p.id === "grok-3-mini");

  check("both vendor pins are extracted", Boolean(groqPin && xaiPin), true);
  check("xAI's grok-3-mini is NOT attributed to groq", attribute(KIVVI_MULTI_VENDOR, xaiPin.line), "xai");
  check("the groq pin above it still attributes to groq", attribute(KIVVI_MULTI_VENDOR, groqPin.line), "groq");

  // Only groq is queryable, so the xAI id must land in unchecked — never judged
  // against a catalogue that was never going to list it.
  const findings = pins.map((p) => ({
    repo: "kivvi",
    path: "apps/web/lib/ai/call-provider.ts",
    line: p.line,
    id: p.id,
    vendor: attribute(KIVVI_MULTI_VENDOR, p.line),
  }));
  const judged = judge(findings, new Map([["groq", GROQ_LIVE]]));
  check("the real groq pin is still caught as retired", judged.filter((j) => j.state === "gone").map((j) => j.id), ["llama-3.1-8b-instant"]);
  check("the xAI pin is unchecked, not retired", judged.filter((j) => j.state === "unchecked").map((j) => j.id), ["grok-3-mini"]);
}

// ── a display label is not a pin ────────────────────────────────────
//
// Regression: the audit announced a RETIRED model in OrangeCat, a repo with
// nothing wrong. The string was marketing copy in a pricing table — every other
// entry contained a space and was filtered out, `GPT-4o` did not. Reporting a
// healthy repo as broken is how a daily gate loses its reader.
//
// Both halves are asserted. Suppressing the false one is only worth doing if
// the real retired pin in the very same file is still caught.

console.log("\ndisplay labels vs real pins");

const ORANGECAT_UI = `
import { OPENROUTER_API_URL } from './constants'

export const TIERS = {
  standard: {
    title: 'Standard Tier',
    models: ['Claude 3.5 Sonnet', 'GPT-4o', 'Gemini 2.0 Flash'],
  },
}

// the actual call, further down the same file
const model = 'openai/gpt-oss-20b:free'
`;

{
  check("an uppercase id is impossible at openrouter", possibleAt("openrouter", "GPT-4o"), false);
  check("and impossible at groq", possibleAt("groq", "Llama-3.3-70B"), false);
  check("but lowercase ids stay possible", possibleAt("openrouter", "openai/gpt-oss-20b:free"), true);
  // Uppercase is only impossible where the catalogue was measured. Together's
  // real ids DO carry capitals, so the rule must not spread to every vendor.
  check("uppercase is not ruled out at vendors we did not measure", possibleAt("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"), true);

  const pins = extractPins(ORANGECAT_UI);
  const findings = pins.map((p) => ({
    repo: "orangecat",
    path: "src/lib/ai-guidance.ts",
    line: p.line,
    id: p.id,
    vendor: attribute(ORANGECAT_UI, p.line),
  }));
  const judged = judge(findings, new Map([["openrouter", OR_LIVE]]));

  check(
    "the display label is not reported as retired",
    judged.filter((j) => j.state === "gone").map((j) => j.id).includes("GPT-4o"),
    false,
  );
  check(
    "it is listed as unjudged rather than dropped",
    judged.filter((j) => j.state === "unattributed").map((j) => j.id).includes("GPT-4o"),
    true,
  );
  // OR_LIVE contains openai/gpt-oss-20b:free, so the real pin here is live —
  // what matters is that it was judged at all, not silenced alongside the label.
  check(
    "the real pin in the same file is still judged against the catalogue",
    judged.find((j) => j.id === "openai/gpt-oss-20b:free")?.state,
    "ok",
  );
}

// ── which files get opened ───────────────────────────────────────────
//
// Regression, and the expensive kind: a MISS, not a false alarm.
//
// The filter used to require the AI word in the FILENAME. Kivvi keeps its
// provider clients side by side in packages/ai/src/providers/, and the audit
// opened `anthropic.ts` while never opening `groq.ts` next to it — decided
// entirely by which vendor names happened to be in a regex. Three retired ids
// sat in the unopened files, so the report said Kivvi had 2 dead pins when it
// had 6.
//
// Understating a repo is worse than skipping it. A skipped repo is absent; an
// understated one prints a number that reads like an answer.

console.log("\nwhich files get opened");

{
  // The four files from the miss, verbatim.
  check("a vendor-named file under an ai/ directory is likely", isLikelyPath("packages/ai/src/providers/groq.ts"), true);
  check("...and so is its openrouter sibling", isLikelyPath("packages/ai/src/providers/openrouter.ts"), true);
  check("...and the index.ts beside them", isLikelyPath("packages/ai/src/providers/index.ts"), true);
  check("...and the one that already worked still works", isLikelyPath("packages/ai/src/providers/anthropic.ts"), true);

  check("the app-side caller stays likely", isLikelyPath("apps/web/lib/ai/call-provider.ts"), true);
  check("env schemas are always opened", isLikelyPath("src/lib/env.ts"), true);
  check("so are .env.example files", isLikelyPath(".env.example"), true);

  // Botsmann's pin lived here, in a path naming no vendor and no AI concern.
  check("a bare constants file is not likely", isLikelyPath("lib/constants.ts"), false);
  check("...but is still a candidate, via the possible tier", isPossiblePath("lib/constants.ts"), true);
  check("...so it does get opened", isCandidatePath("lib/constants.ts"), true);
}

// Matching is by token, never substring — this is the half that keeps the fix
// from turning one blind spot into a flood. `ai` is a substring of all of these,
// and the cap would then drop real candidates to make room for them.
{
  check("mail is not ai", segmentNamesAI("mail.ts"), false);
  check("domain is not ai", segmentNamesAI("domain.ts"), false);
  check("detail is not ai", segmentNamesAI("detail.ts"), false);
  check("maintenance is not ai", segmentNamesAI("maintenance.ts"), false);
  check("captain is not ai", segmentNamesAI("captain.ts"), false);

  check("but ai is ai", segmentNamesAI("ai"), true);
  check("and ai-guidance is ai", segmentNamesAI("ai-guidance.ts"), true);
  check("and call-provider is a provider", segmentNamesAI("call-provider.ts"), true);
  check("and llm-client is an llm", segmentNamesAI("llm-client.ts"), true);

  check("an unrelated util is not opened", isCandidatePath("src/lib/format-date.ts"), false);
  check("nor is a mailer", isCandidatePath("src/lib/mail.ts"), false);
}

// ── model arrays the old regex could not read ─────────────────────────────
//
// Second half of the Kivvi miss. Even once the file was being opened, nothing
// came out of it: the extractor matched `models` followed directly by `[`, and
// Kivvi writes a TypeScript type annotation in between.
//
//     models: AIModel[] = [
//
// The first `[` on that line belongs to `AIModel[]` and closes immediately, so
// anchoring to it reads an empty array — a silent nothing, which is the worst
// possible output for an audit. Two retired Groq ids sat inside.

console.log("\nmodel arrays");

const KIVVI_TYPED_ARRAY = `
import type { AIModel } from "../types";

/** Uses OpenAI-compatible API at https://api.groq.com/openai/v1. */
export class GroqProvider extends OpenAICompatibleProvider {
  id = "groq";
  name = "Groq";

  models: AIModel[] = [
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B",
      contextWindow: 128000,
      supportsTools: true,
      costPer1kInput: 0,
    },
    {
      id: "llama-3.1-8b-instant",
      name: "Llama 3.1 8B Instant",
      contextWindow: 128000,
      supportsTools: true,
      costPer1kInput: 0,
    },
  ];

  protected baseUrl = "https://api.groq.com/openai/v1";
}
`;

{
  const pins = extractPins(KIVVI_TYPED_ARRAY);
  const ids = pins.map((p) => p.id).sort();
  check(
    "a type-annotated models array is read at all",
    ids,
    ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
  );

  // The SECOND entry is the one a fixed-width window loses. The old pattern
  // read at most 400 characters after `models`, and a richly described list
  // runs past that long before it ends.
  check("the second entry is not lost to a character budget", ids.length, 2);

  // Human-readable names sit in the same objects and must not be mistaken for
  // ids — they are filtered by shape, not by position.
  check("display names in the same object are not pins", ids.includes("Llama 3.3 70B"), false);

  // Each id reports its OWN line, not the line the array opened on. Vendor
  // attribution is measured in lines from the pin, so a whole array collapsed
  // onto one line would attribute every entry from the same neighbourhood.
  const lines = pins.map((p) => p.line);
  check("each id carries its own line number", new Set(lines).size, 2);

  for (const pin of pins) {
    check(`${pin.id} attributes to groq`, attribute(KIVVI_TYPED_ARRAY, pin.line), "groq");
  }

  const regions = modelListRegions(KIVVI_TYPED_ARRAY);
  check("exactly one models array is found in the file", regions.length, 1);
}

{
  // The plain shapes must keep working.
  check("a one-line string form still reads", extractPins(`const model = 'openai/gpt-oss-120b'`).map((p) => p.id), ["openai/gpt-oss-120b"]);
  check(
    "a plain inline array still reads",
    extractPins(`models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']`).map((p) => p.id).sort(),
    ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  );
  check(
    "an assignment without an annotation still reads",
    extractPins(`const models = [\n  "openai/gpt-oss-120b",\n]`).map((p) => p.id),
    ["openai/gpt-oss-120b"],
  );
}

// ── model MAPS, not just arrays ─────────────────────────────────────
//
// Third discovery in the same sweep, and it cost two more repos.
//
// Once arrays were readable, two repos still reported nothing, because their
// ids live in object literals — and on OPPOSITE sides of the colon. Hirnli
// keeps them as map values, Orangecat as map keys, including
// `DEFAULT_GROQ_MODEL`, the baseline every free non-BYOK user gets. Both were
// entirely retired and both read as clean.
//
// So the walker takes `{` as readily as `[`, and every quoted string in the
// region is a candidate regardless of which side of the colon it is on.

console.log("\nmodel maps");

// Hirnli's shape: the id is the VALUE.
const HIRNLI_ALIAS_MAP = `
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Available models with different rate limits */
export const GROQ_MODELS = {
  '70b': 'llama-3.3-70b-versatile',     // 12k TPM, best quality
  '8b': 'llama-3.1-8b-instant',          // 20k TPM, faster, good for triage
} as const;
`;

// Orangecat's shape: the id is the KEY, and the value is a nested object.
const ORANGECAT_REGISTRY = `
// Groq's best free models
const GROQ_MODELS = {
  // Fast, capable model - great for chat
  'llama-3.3-70b-versatile': {
    name: 'Llama 3.3 70B Versatile',
    contextWindow: 128000,
    maxOutputTokens: 32768,
  },
  'llama-3.1-8b-instant': {
    name: 'Llama 3.1 8B Instant',
    contextWindow: 128000,
    maxOutputTokens: 8192,
  },
} as const;

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
`;

{
  const ids = extractPins(HIRNLI_ALIAS_MAP).map((p) => p.id).sort();
  check(
    "ids that are map VALUES are found",
    ids,
    ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
  );
  // '70b' and '8b' are the keys here. They are aliases, not ids, and must not
  // be reported as pins — `looksLikeModelId` is what keeps them out.
  check("the size aliases beside them are not mistaken for ids", ids.includes("8b"), false);
}

{
  const pins = extractPins(ORANGECAT_REGISTRY);
  const ids = pins.map((p) => p.id).sort();
  check(
    "ids that are map KEYS are found",
    ids,
    ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
  );
  // Nested objects inside the map must not end the region early.
  check("a nested object does not truncate the map", ids.length, 2);
  // Human-readable names sit in the same nested objects.
  check("display names inside the map are not pins", ids.includes("Llama 3.3 70B Versatile"), false);

  for (const pin of pins) {
    check(`${pin.id} in a map attributes to groq`, attribute(ORANGECAT_REGISTRY, pin.line), "groq");
  }

  const judged = judge(
    pins.map((p) => ({ repo: "orangecat", path: "src/services/ai/groq.ts", line: p.line, id: p.id, vendor: "groq" })),
    new Map([["groq", GROQ_LIVE]]),
  );
  check("and both are judged retired against the live catalogue", judged.filter((j) => j.state === "gone").length, 2);
}

{
  // The walker must not mistake an ordinary import for a model collection.
  check("an import naming models opens no region", modelListRegions(`import { getAllModels } from "./providers";`).length, 0);
}

// A size alias is not a model id.
{
  console.log("\nseparators");
  check("a bare size token is not an id", looksLikeModelId("70b"), false);
  check("nor is the two-character one", looksLikeModelId("8b"), false);
  check("routed ids are ids", looksLikeModelId("openai/gpt-oss-120b"), true);
  check("hyphenated ids are ids", looksLikeModelId("llama-3.3-70b-versatile"), true);
  check("dotted ids are ids", looksLikeModelId("llama3.2"), true);
  check("short hyphenated ids are ids", looksLikeModelId("codex-4"), true);
}

// A loop over models is not a declaration of models.
//
// Regression from the map support: `{` as an opener made
// `for (const model of models) {` open a region across the whole loop body, so
// the request headers inside it were read as ids and a Content-Type header was
// reported as a retired Groq model. Widening a matcher is exactly when to check
// what it now swallows.
{
  console.log("\ndeclarations only");

  const LOOP = `
  const models = groqModels();
  for (const model of models) {
    const response = await fetch(API_CONFIG.GROQ_API_URL, {
      headers: {
        Authorization: \`Bearer \${key}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages }),
    });
  }
  `;

  check("a for-of over models opens no region", modelListRegions(LOOP).length, 0);
  check("so a content-type header is not a model", extractPins(LOOP).map((p) => p.id), []);

  // The declaration forms must still open one.
  check("a const array declaration still opens", modelListRegions(`const models = [`).length, 1);
  check("an annotated declaration still opens", modelListRegions(`  models: AIModel[] = [`).length, 1);
  check("a map declaration still opens", modelListRegions(`export const GROQ_MODELS = {`).length, 1);
  check("an inline property still opens", modelListRegions(`models: ['a/b-1'],`).length, 1);
}

// `modelId` is not `model`.
//
// Regression found by re-running the live sweep after tightening the collection
// walker to plural-only: a real retired id in Kivvi disappeared from the report.
// Its declaration is singular (`const FALLBACK_MODEL: ModelSelection = {`), so
// the walker correctly ignores it, and the single-id pattern was anchored on the
// bare word `model` — which does not match `modelId`. Nothing covered it.
{
  console.log("\nsingle-id property shapes");

  const KIVVI_FALLBACK = `
const STORAGE_KEY = "kivvi-selected-model";

// Fallback default — used before API loads or when stored model is unavailable
const FALLBACK_MODEL: ModelSelection = {
  providerId: "groq",
  modelId: "llama-3.3-70b-versatile",
};
`;

  const ids = extractPins(KIVVI_FALLBACK).map((p) => p.id);
  check("a modelId property is a pin", ids.includes("llama-3.3-70b-versatile"), true);
  check("the storage key beside it is not", ids.includes("kivvi-selected-model"), false);

  check("model_id also reads", extractPins(`model_id = "openai/gpt-oss-120b"`).map((p) => p.id), ["openai/gpt-oss-120b"]);
  check("modelName also reads", extractPins(`modelName: 'openai/gpt-oss-20b'`).map((p) => p.id), ["openai/gpt-oss-20b"]);

  // A parameter annotation is still not a pin.
  check("a typed parameter is not a pin", extractPins(`function f(model: string): boolean { return model.startsWith("qwen/"); }`).map((p) => p.id), []);
}

// A provider-keyed record names its own rows.
//
// OrangeCat's `gpt-4o-mini` was reported as a RETIRED OPENROUTER model. It is
// not an OpenRouter id at all — there it would be `openai/gpt-4o-mini` — it is
// OpenAI's, sitting under an `openai:` key. The nearest marker above it was
// OpenRouter's base URL in the block before, so nearest-marker-above put it with
// the wrong vendor and then judged it against a catalogue that was never going
// to list it.
//
// The bare word `openai` cannot be a general marker: `api.groq.com/openai/v1`
// contains it, and every `openai/gpt-oss-*` id Groq serves. Anchoring to a line
// that STARTS with the key and a colon is what makes it safe.
{
  console.log("provider-keyed records");

  const ORANGECAT_RUNTIME = `
export const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
} as const;

export const PROVIDER_RUNTIME = {
  openai: {
    baseUrl: PROVIDER_BASE_URLS.openai,
    defaultModel: 'gpt-4o-mini',
  },
  openrouter: {
    baseUrl: PROVIDER_BASE_URLS.openrouter,
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
  },
};
`;

  const pins = extractPins(ORANGECAT_RUNTIME);
  const at = (id) => pins.find((p) => p.id === id);

  check("both defaults are extracted", pins.length >= 2, true);
  check(
    "an id under an openai: key belongs to openai",
    attribute(ORANGECAT_RUNTIME, at("gpt-4o-mini").line),
    "openai",
  );
  check(
    "and the one under openrouter: belongs to openrouter",
    attribute(ORANGECAT_RUNTIME, at("nvidia/nemotron-3-super-120b-a12b:free").line),
    "openrouter",
  );

  // OpenAI is not queryable, so its pin must be reported UNCHECKED — never
  // judged against a catalogue that could not list it.
  const judged = judge(
    pins.map((p) => ({ repo: "orangecat", path: "src/config/ai-provider-runtime.ts", line: p.line, id: p.id, vendor: attribute(ORANGECAT_RUNTIME, p.line) })),
    new Map([["openrouter", new Set(["nvidia/nemotron-3-super-120b-a12b:free"])]]),
  );
  check("the openai pin is unchecked, not retired", judged.find((j) => j.id === "gpt-4o-mini")?.state, "unchecked");
  check("the openrouter pin is confirmed live", judged.find((j) => j.id === "nvidia/nemotron-3-super-120b-a12b:free")?.state, "ok");
}

// Ollama is local: its tags are attributed, never judged.
{
  console.log("\nlocal providers");

  const EVIG_ENV = `
# Groq (cloud)
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

# Ollama URL (local LLM - for local embeddings only)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
`;

  const pins = extractPins(EVIG_ENV);
  const ollamaPin = pins.find((p) => p.id === "llama3.2");
  check("the ollama tag is extracted", Boolean(ollamaPin), true);
  // Before this, the nearest marker above was GROQ_MODEL and `llama3.2` was
  // reported as a retired GROQ model. It is a valid Ollama tag on a healthy
  // line; Groq simply never served anything by that name.
  check("and attributed to ollama, not groq", attribute(EVIG_ENV, ollamaPin.line), "ollama");

  const judged = judge(
    [{ repo: "evig", path: ".env.example", line: ollamaPin.line, id: "llama3.2", vendor: "ollama" }],
    new Map([["groq", GROQ_LIVE]]),
  );
  check("a local tag is unchecked, never retired", judged[0].state, "unchecked");
}

console.log(failures ? `\n✗ ${failures} failure(s)` : "\n✓ all checks pass");
process.exit(failures ? 1 : 0);
