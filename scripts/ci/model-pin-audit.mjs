#!/usr/bin/env node
/**
 * Fleet audit: is any model id this fleet pins no longer served?
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-26 the AOZ assistant answered "KI-Assistent nicht konfiguriert.
 * Bitte GROQ_API_KEY setzen" on a deployment whose key was valid. Groq had
 * retired the whole llama-3.x family; the pinned `llama-3.3-70b-versatile`
 * returned 404 model_not_found. Production had been broken as long as the demo
 * and nobody knew, because the only thing the app can say is "not configured".
 *
 * That is not an AOZ bug. Every Groq id pinned anywhere in the fleet was dead
 * the same morning — llama-3.1-8b-instant, llama3-8b-8192, gemma2-9b-it,
 * mixtral-8x7b-32768, llama-3.2-3b-instruct — across eleven repos, with three
 * deployed apps failing live.
 *
 * A pinned free model is not a configuration, it is a scheduled outage. The
 * schedule is set by the vendor and nobody here is told. So this asks the only
 * authority that knows: the vendor's own catalogue.
 *
 * WHY A CENTRAL SCRIPT AND NOT A CHECK PER REPO
 * ---------------------------------------------
 * Same doctrine as verify-floor-audit.sh and ui-defect-audit.mjs. A check
 * copied into twenty repos drifts into twenty versions — SHARED.md counts the
 * bill for exactly that habit. More to the point, a per-repo check only ever
 * runs in repos somebody still touches, and the repos that rot quietly are
 * precisely the ones nobody touches. This one needs no adoption at all.
 *
 * WHY IT REUSES ai-kit
 * --------------------
 * `checkCatalog` already answers this, already distinguishes the three states
 * that matter, and already carries the scars — its own docstring records four
 * of nine default pins gone and a consumer silently failing for eight days.
 * Writing a second vendor query here would be this repo committing the sin it
 * exists to police. It takes the chain as an ARGUMENT, so it generalises to
 * arbitrary ids with no change to the package.
 *
 * ZERO TOKENS, WHICH IS THE WHOLE POINT
 * -------------------------------------
 * One GET /models per vendor. No completion, no spend. That is the difference
 * between a check that runs on a timer and a command somebody is supposed to
 * remember — and "supposed to remember" is what failed for eight days.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * That a listed model WORKS. Existence is cheap; capability is not. A model
 * can be listed and still refuse tool calls — of nine free models probed for
 * ai-kit's default chain, five answered only via a text protocol. If the
 * surface is a tool loop, probe with a real tool call before pinning. This
 * audit catches the retirement, not the mismatch.
 *
 * It also judges only ids it can ATTRIBUTE to a vendor it queried. An
 * unattributed id is reported and not judged, because "I could not look" and
 * "it is gone" are different answers and collapsing them invents outages.
 *
 * Usage:
 *   node scripts/ci/model-pin-audit.mjs                # audit, exit 1 on dead pins
 *   node scripts/ci/model-pin-audit.mjs --warn-only    # report, always exit 0
 *   node scripts/ci/model-pin-audit.mjs --local        # scan ~/dev checkouts
 *
 * Env: GH_OWNER (default bitbaum), GH_LIMIT (default 100),
 *      FLEET_ROOT (default ~/dev, --local only),
 *      AI_KIT_FROM (path to a repo that installs ai-kit),
 *      GROQ_API_KEY / OPENROUTER_API_KEY (to read the catalogues).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const exec = promisify(execFile);

const WARN_ONLY = process.argv.includes("--warn-only");
const LOCAL = process.argv.includes("--local");
const OWNER = process.env.GH_OWNER ?? "bitbaum";
const GH_LIMIT = process.env.GH_LIMIT ?? "100";
const FLEET_ROOT = process.env.FLEET_ROOT ?? join(homedir(), "dev");

/**
 * The vendors whose catalogue we can actually read, and the markers that tie a
 * pin to one of them.
 *
 * Attribution is by MARKER rather than by the shape of the id, because the shape
 * lies: `openai/gpt-oss-20b` is a Groq model id AND an OpenRouter routing id,
 * and at OpenRouter the missing `:free` suffix is the difference between free
 * and billed. Only the surrounding code knows which vendor is meant.
 */
export const VENDORS = [
  {
    id: "groq",
    queryable: true,
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    markers: [/groq/i],
    // A provider-keyed record — `groq: { defaultModel: '...' }` — names the
    // vendor for everything inside it, and sits closer to the pin than any URL.
    keyMarker: /^[ \t]*['"]?groq['"]?\s*:/m,
  },
  {
    id: "openrouter",
    queryable: true,
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    markers: [/openrouter/i],
    keyMarker: /^[ \t]*['"]?openrouter['"]?\s*:/m,
  },
  // Not queryable here — no catalogue call is wired for these. They are listed
  // so their ids are ATTRIBUTED and reported unchecked, rather than falling to
  // whichever queryable vendor happens to sit nearest in the file. Markers are
  // deliberately specific: bare /openai/ would match Groq's own
  // `api.groq.com/openai/v1` path and every `openai/gpt-oss-*` id it serves.
  // Ollama runs on the user's own machine, so "is this id still served" is not
  // a question with a fleet-wide answer — whatever the operator pulled is what
  // exists. It is listed so its ids are ATTRIBUTED rather than falling to the
  // nearest cloud vendor above them.
  //
  // Without this, evig's `.env.example` line `OLLAMA_MODEL=llama3.2` was
  // attributed to Groq — the nearest marker above it — and reported RETIRED.
  // `llama3.2` is a perfectly valid Ollama tag on a healthy line; Groq simply
  // never served anything by that name. Same class as the pricing-table false
  // positive: a true statement about the wrong vendor.
  {
    id: "ollama",
    queryable: false,
    markers: [/\bOLLAMA_[A-Z_]+\b/, /\bollama\b/i, /localhost:11434/, /127\.0\.0\.1:11434/],
  },
  //
  // `keyMarker` is how a provider-keyed record names its own rows. OrangeCat
  // writes:
  //
  //     export const PROVIDER_BASE_URLS = { openai: '...', openrouter: '...' }
  //     export const PROVIDER_RUNTIME = {
  //       openai: { baseUrl: ..., defaultModel: 'gpt-4o-mini' },
  //
  // The pin belongs to OpenAI, but the nearest marker above it was OpenRouter's
  // URL in the block before — so `gpt-4o-mini` was reported as a retired
  // OpenRouter model. It is not an OpenRouter id at all; there it would be
  // `openai/gpt-4o-mini`. The bare key `openai:` is deliberately not in
  // `markers`, because `api.groq.com/openai/v1` contains that word — anchoring
  // it to the start of a line followed by a colon is what makes it safe.
  { id: "xai", queryable: false, markers: [/api\.x\.ai/i, /\bXAI_API_KEY\b/, /\bgrok\b/i], keyMarker: /^[ \t]*['"]?xai['"]?\s*:/m },
  { id: "anthropic", queryable: false, markers: [/api\.anthropic\.com/i, /\bANTHROPIC_API_KEY\b/], keyMarker: /^[ \t]*['"]?anthropic['"]?\s*:/m },
  { id: "openai", queryable: false, markers: [/api\.openai\.com/i, /\bOPENAI_API_KEY\b/], keyMarker: /^[ \t]*['"]?openai['"]?\s*:/m },
  { id: "google", queryable: false, markers: [/generativelanguage\.googleapis/i, /\bGEMINI_API_KEY\b/], keyMarker: /^[ \t]*['"]?google['"]?\s*:/m },
  { id: "together", queryable: false, markers: [/api\.together\.xyz/i, /\bTOGETHER_API_KEY\b/], keyMarker: /^[ \t]*['"]?together['"]?\s*:/m },
  { id: "deepseek", queryable: false, markers: [/api\.deepseek\.com/i, /\bDEEPSEEK_API_KEY\b/], keyMarker: /^[ \t]*['"]?deepseek['"]?\s*:/m },
];

/**
 * Files worth opening, in two tiers.
 *
 * LIKELY names an AI module outright. POSSIBLE is the long tail that a
 * name-based filter misses: botsmann keeps its model id in `lib/constants.ts`,
 * which mentions no vendor in its path and was invisible to the first version
 * of this filter. A pin does not have to live in a file called `provider.ts`.
 */
/**
 * Words that make a path segment worth opening — a DIRECTORY name as readily as
 * a file name.
 *
 * The previous version of this filter required the word to appear in the
 * FILENAME, and the cost of that was measured rather than imagined. Kivvi keeps
 * its provider clients in `packages/ai/src/providers/`:
 *
 *   packages/ai/src/providers/anthropic.ts   ← scanned
 *   packages/ai/src/providers/groq.ts        ← never opened
 *   packages/ai/src/providers/openrouter.ts  ← never opened
 *   packages/ai/src/providers/index.ts       ← never opened
 *
 * Two files in the same directory, one seen and one not, decided entirely by
 * which vendor names someone had typed into a regex. Three retired ids lived in
 * the unopened ones, so the audit reported Kivvi as having 2 dead pins when it
 * had 6 — and understating a repo is worse than missing it outright, because
 * the number looks like an answer.
 *
 * Matching is by TOKEN, never substring. `ai` as a substring appears in `mail`,
 * `chain`, `domain`, `detail` and `maintenance`; as a token it appears in `ai`,
 * `ai-guidance` and `open-ai`. Substring matching here would have quietly
 * traded this blind spot for a flood of irrelevant files, and the cap would then
 * have dropped real candidates to make room.
 */
const AI_TOKENS = new Set([
  // the concern
  "ai", "llm", "gpt", "model", "models", "provider", "providers", "chain",
  "chat", "chats", "completion", "completions", "prompt", "prompts",
  "agent", "agents", "embedding", "embeddings", "inference",
  // the vendors — every one of these is a plausible file name, and the list
  // being short is exactly what caused the miss above
  "groq", "openrouter", "openai", "anthropic", "claude", "xai", "grok",
  "gemini", "google", "ollama", "mistral", "together", "deepseek", "cohere",
  "nvidia", "perplexity", "fireworks", "replicate",
]);

/** Directories that can contain application source. */
const SOURCE_ROOT = /^(lib|src|app|apps|packages|config|server|services|api)$/i;

/** Does this one path segment name an AI concern or a vendor? */
export function segmentNamesAI(segment) {
  const base = segment.replace(/\.(ts|js|mjs|tsx|jsx)$/i, "").toLowerCase();
  return base.split(/[^a-z0-9]+/).some((token) => AI_TOKENS.has(token));
}

/**
 * A file that almost certainly decides which model gets called.
 *
 * The AI word may sit anywhere below the source root — `ai/providers/groq.ts`
 * qualifies on its directory alone, which is the whole point.
 */
export function isLikelyPath(path) {
  if (/(^|\/)\.env\.example$/i.test(path)) return true;
  if (/(^|\/)env\.(ts|js|mjs)$/i.test(path)) return true;
  if (!/\.(ts|js|mjs)$/i.test(path)) return false;

  const segments = path.split("/");
  const rootAt = segments.findIndex((seg) => SOURCE_ROOT.test(seg));
  if (rootAt < 0) return false;
  return segments.slice(rootAt + 1).some(segmentNamesAI);
}

/**
 * The long tail a name-based filter misses. Botsmann kept its model id in
 * `lib/constants.ts`, which mentions no vendor and no AI concern anywhere in
 * its path. A pin does not have to live in a file called `provider.ts`.
 */
export function isPossiblePath(path) {
  return /(^|\/)(lib|src|app|apps|packages|config)\/.*(constants?|config|settings|defaults)[^/]*\.(ts|js|mjs)$/i.test(
    path,
  );
}

/** Worth opening at all. */
export function isCandidatePath(path) {
  return isLikelyPath(path) || isPossiblePath(path);
}

/** Never open these, whatever they are named. */
const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|\.next|coverage|__tests__|__fixtures__)\/|(^|\/)\.claude\/worktrees\//;

/**
 * How many candidate files one repo may cost.
 *
 * Raised 90 -> 160 because the coverage ledger stopped being a caveat and
 * became a finding: on 2026-08-27 it reported OrangeCat opening 90 of 133 with
 * 4 likely-AI files dropped, and FleetCrown 90 of 109 with 15 dropped. Ranking
 * puts likely files first, so shedding generic config is harmless — shedding
 * fifteen files that name an AI concern is a blind spot, and in the two largest
 * repos in the fleet.
 *
 * 160 clears both with headroom. The ledger stays, because the next repo to
 * outgrow the cap should say so rather than quietly report a smaller number.
 */
const MAX_FILES_PER_REPO = 160;

/** A vendor named 40+ lines from a pin is not describing that pin. */
const MAX_ATTRIBUTION_DISTANCE = 40;

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Is this string plausibly a model id rather than any other quoted thing?
 *
 * Deliberately permissive on shape and strict on the obvious negatives. A false
 * POSITIVE costs one line in a report that says "not judged"; a false NEGATIVE
 * is the outage this whole file exists to prevent.
 */
export function looksLikeModelId(s) {
  if (typeof s !== "string") return false;
  if (s.length < 3 || s.length > 80) return false;
  if (/\s/.test(s)) return false;
  if (s.includes("${")) return false; // interpolated: resolved at runtime, not pinned
  if (/^https?:/i.test(s)) return false;
  if (/^[./~@]/.test(s)) return false;
  if (/\.(ts|tsx|js|mjs|cjs|json|css|scss|md|png|jpe?g|svg|ico|txt|ya?ml)$/i.test(s)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(s)) return false; // SCREAMING_CASE is an env name
  // Model ids essentially always carry a version digit or a vendor/ prefix.
  // A vendor id always carries a separator: a slash for routed ids
  // (`openai/gpt-oss-120b`), or a hyphen or dot within the name
  // (`llama-3.3-70b-versatile`, `llama3.2`, `codex-4`). Nothing in either live
  // catalogue is a single unseparated word.
  //
  // Without this, reading model MAPS turned their keys into findings: Hirnli's
  // alias table is `{ '70b': '...', '8b': '...' }`, and `70b` has a digit and no
  // space, so it read as a pin and would have been reported retired at Groq. It
  // is a size alias. `8b` escaped only by being two characters long, which is
  // not a rule anyone should rely on.
  if (!/[/.-]/.test(s)) return false;

  return /\d/.test(s) || s.includes("/");
}

/**
 * The lines making up each `models` collection, with real line numbers.
 *
 * A tiny bracket walker rather than a regex, because the shapes in this fleet
 * defeat any single pattern. All four of these are one repo's way of saying the
 * same thing, and every one of them hid a retired id at some point:
 *
 *     models: ['a', 'b']                        an inline array
 *     models: AIModel[] = [                     an array behind a TS annotation
 *     GROQ_MODELS = { '8b': 'llama-...' }       a map whose VALUES are ids
 *     GROQ_MODELS = { 'llama-...': { ... } }    a map whose KEYS are ids
 *
 * Maps were the second discovery and cost two more repos. Hirnli kept its ids
 * as map values and Orangecat as map keys — including `DEFAULT_GROQ_MODEL`,
 * the baseline every free user gets — and an array-only walker read straight
 * past both. So the opener is `[` or `{`, and every quoted string in the region
 * is a candidate regardless of which side of the colon it sits on.
 *
 * The opening bracket is the LAST one on the declaring line. That is what makes
 * the annotated form work: in `models: AIModel[] = [`, the first `[` belongs to
 * the type and closes immediately, so anchoring to it reads an empty array and
 * reports nothing — a silent miss, the worst output an audit has.
 */
export function modelListRegions(text) {
  const lines = text.split("\n");
  const regions = [];
  const CLOSER = { "[": "]", "{": "}" };

  for (let i = 0; i < lines.length; i++) {
    // Greedy on purpose: it backtracks to the LAST opener within reach.
    //
    // `\w*` before `models` is load-bearing. A bare `\bmodels?\b` does NOT
    // match `GROQ_MODELS`, because the underscore before it is a word character
    // so there is no boundary there — which is precisely why two repos' model
    // maps read as empty. Almost every map in this fleet is named that way.
    //
    // The `[:=]` immediately after the token is what makes this a DECLARATION
    // rather than any line that mentions models. Without it,
    // `for (const model of models) {` opened a region over the whole loop body
    // — and the request headers inside were then read as model ids, so a
    // `Content-Type: application/json` was reported as a retired Groq model.
    // PLURAL only. A singular `model:` is a parameter or a single-id property,
    // and `function supportsReasoningEffort(model: string): boolean {` is a
    // declaration by the rule above — it opened a region over the function body
    // and read the `startsWith("qwen/")` prefixes inside as retired ids.
    // Collections are plural; single ids are matched on one line by the
    // patterns in extractPins.
    const opener = /\b[a-z0-9_]*models\b\s*[:=][^\n]{0,80}[[{]/i.exec(lines[i]);
    if (!opener) continue;

    const open = opener[0].at(-1);
    const close = CLOSER[open];
    const region = [];
    let depth = 0;
    let opened = false;

    // A models collection running past 200 lines is not a models collection.
    for (let j = i; j < lines.length && j < i + 200; j++) {
      const segment = j === i ? lines[j].slice(opener.index + opener[0].length - 1) : lines[j];
      region.push({ line: j + 1, text: segment });

      for (const ch of segment) {
        if (ch === open) {
          depth++;
          opened = true;
        } else if (ch === close) {
          depth--;
        }
      }
      if (opened && depth <= 0) break;
    }

    regions.push(region);
  }

  return regions;
}

/**
 * Pull candidate model ids out of one file's text, with the line each sits on.
 *
 * Three shapes cover how this fleet writes them:
 *   1. a `model:` / `models:` assignment, single value or array
 *   2. a *_MODEL constant or Zod `.default(...)`
 *   3. a bare `GROQ_MODEL=...` line in a .env file
 */
export function extractPins(text) {
  const found = new Map(); // id -> line number (first sighting)
  const lineOf = (index) => text.slice(0, index).split("\n").length;

  const remember = (id, index) => {
    if (!looksLikeModelId(id)) return;
    if (!found.has(id)) found.set(id, lineOf(index));
  };

  const rememberAt = (id, line) => {
    if (!looksLikeModelId(id)) return;
    if (!found.has(id)) found.set(id, line);
  };

  // 1a. model: 'x'  — a single id on one line.
  //
  // The `id|name` suffix is not decoration. Kivvi's fallback reads
  //
  //     const FALLBACK_MODEL: ModelSelection = {
  //       providerId: "groq",
  //       modelId: "llama-3.3-70b-versatile",
  //     };
  //
  // and `modelId` is not `model`, so a pattern anchored on the bare word walked
  // straight past a retired id sitting in the app's default model selection.
  // The declaration above it is singular, so the collection walker does not
  // cover it either — this line is the only thing that does.
  for (const m of text.matchAll(
    /\b[a-z0-9_]*model(?:s|id|_id|name|_name)?\b\s*[:=]\s*['"`]([^'"`\n]{0,120})['"`]/gi,
  )) {
    remember(m[1], m.index);
  }

  // 1b. a models ARRAY, walked by bracket depth rather than matched by regex.
  //
  // This used to be `models?\s*[:=]\s*\[[\s\S]{0,400}?\]`, and it missed a
  // whole package. Kivvi declares its list as:
  //
  //     models: AIModel[] = [
  //
  // A TypeScript type annotation sits between the key and the array, so the
  // pattern never fired, and two retired Groq ids inside were invisible. The
  // 400-character window was the second half of the same problem: a list of
  // richly described models runs well past it, so even a matching array was
  // read only as far as its first two entries.
  //
  // Walking the brackets has neither limit. It also reports each id's OWN line
  // instead of the line the array opened on, which matters because vendor
  // attribution is measured in lines from the pin.
  for (const region of modelListRegions(text)) {
    for (const { line, text: lineText } of region) {
      // Comments are stripped first. A model list is exactly where someone
      // documents the id they just replaced, and such notes are usually written
      // in backticks — so without this, a comment reading "replaces
      // `meta-llama/llama-3.2-3b-instruct:free`, which was retired" reports
      // that id as a live pin, in the very commit that removed it. The audit
      // would be reporting on prose instead of code: the exact failure it
      // exists to catch elsewhere.
      const code = lineText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "");
      for (const q of code.matchAll(/['"`]([^'"`\n]+)['"`]/g)) rememberAt(q[1], line);
    }
  }

  // 2. GROQ_MODEL: z.string().default('x')   |   const DEFAULT_MODEL = 'x'
  for (const m of text.matchAll(
    /\b([A-Za-z][A-Za-z0-9_]*MODEL[A-Za-z0-9_]*)\s*[:=][^\n]{0,80}?['"`]([^'"`\n]+)['"`]/g,
  )) {
    remember(m[2], m.index);
  }

  // 3. .env style, unquoted or quoted, no code around it
  for (const m of text.matchAll(/^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*MODEL[A-Z0-9_]*\s*=\s*["']?([^"'\s#]+)/gm)) {
    remember(m[1], m.index);
  }

  return [...found].map(([id, line]) => ({ id, line }));
}

/**
 * Which vendor does this pin belong to?
 *
 * Nearest-marker first: a file can legitimately name both vendors — AOZ's
 * provider.ts resolves Groq AND OpenRouter in one module — so a file-wide vote
 * would attribute both vendors' pins to whichever appeared more. The pin's own
 * neighbourhood is what actually says which branch it is in. Only when the
 * window is silent do we fall back to the file, and only when the file names
 * exactly one vendor.
 *
 * Returns a vendor id, or null for "cannot tell" — which is reported, not judged.
 */
export function attribute(text, line, vendors = VENDORS, maxDistance = MAX_ATTRIBUTION_DISTANCE) {
  const lines = text.split("\n");

  /**
   * Distance to this vendor's nearest mention ABOVE the pin, and below it.
   *
   * Above is what decides. Every provider module in this fleet is written as
   * `if (provider === "groq") { url = ...; body = { model: "..." } }` — the
   * branch that owns a model literal always opens above it. Ranking by raw
   * proximity instead put `grok-3-mini` (xAI, line 89) with Groq, whose URL sat
   * at line 71, and tied kivvi's real Groq pin exactly between two vendors.
   */
  const distances = (vendor) => {
    let above = Infinity;
    let below = Infinity;
    // `keyMarker` counts as a mention: in a provider-keyed record, the row's
    // own key is the most local and most reliable statement of which vendor a
    // pin belongs to — closer than any base URL, and unambiguous.
    const mentions = (l) =>
      vendor.markers.some((re) => re.test(l)) || (vendor.keyMarker?.test(l) ?? false);

    for (let i = 0; i < lines.length; i++) {
      if (!mentions(lines[i])) continue;
      const d = i + 1 - line;
      if (d <= 0) above = Math.min(above, -d);
      else below = Math.min(below, d);
    }
    return { above, below };
  };

  const scored = vendors.map((v) => ({ id: v.id, ...distances(v) }));

  const fromAbove = scored.filter((s) => s.above <= maxDistance).sort((a, b) => a.above - b.above);
  if (fromAbove.length === 1) return fromAbove[0].id;
  if (fromAbove.length > 1 && fromAbove[0].above < fromAbove[1].above) return fromAbove[0].id;

  // Nothing above governs it — a pin at the top of a file, or a config block
  // whose vendor is named afterwards. Fall back to the nearest mention below.
  if (fromAbove.length === 0) {
    const fromBelow = scored.filter((s) => s.below <= maxDistance).sort((a, b) => a.below - b.below);
    if (fromBelow.length === 1) return fromBelow[0].id;
    if (fromBelow.length > 1 && fromBelow[0].below < fromBelow[1].below) return fromBelow[0].id;
  }

  const named = vendors.filter(
    (v) => v.markers.some((re) => re.test(text)) || (v.keyMarker?.test(text) ?? false),
  );
  return named.length === 1 ? named[0].id : null;
}

/**
 * Turn per-file findings into per-vendor id lists plus the unattributable rest.
 * Pure, so the self-test can drive it without a network or a checkout.
 */
export function collate(findings) {
  const byVendor = new Map();
  const unattributed = [];

  for (const f of findings) {
    if (!f.vendor) {
      unattributed.push(f);
      continue;
    }
    if (!byVendor.has(f.vendor)) byVendor.set(f.vendor, []);
    byVendor.get(f.vendor).push(f);
  }
  return { byVendor, unattributed };
}

/**
 * Apply catalogue verdicts to the findings.
 *
 * `live` is a Map of vendorId -> Set of ids, or null for a vendor whose
 * catalogue could not be read. Null is NOT an empty set: treating "I could not
 * look" as "nothing is there" reports every pin as retired and invents an
 * outage, which is worse than silence because someone acts on it.
 */
/**
 * Vendors whose entire published catalogue is lowercase.
 *
 * MEASURED, not assumed: on 2026-08-26 Groq listed 14 ids and OpenRouter 416,
 * and not one of those 430 contained a capital letter. So an id carrying a
 * capital cannot be a RETIRED id at these two — it was never one of their ids
 * at all, and "retired" is the wrong diagnosis rather than merely the wrong
 * target.
 *
 * This rule exists because the audit reported a retired pin in a repo that had
 * nothing wrong. OrangeCat renders a pricing table:
 *
 *   models: ['Claude 3.5 Sonnet', 'GPT-4o', 'Gemini 2.0 Flash']
 *
 * — human-readable marketing copy that never reaches an API. `GPT-4o` was the
 * only entry without a space, so it slipped the shape filter, landed nearest an
 * OpenRouter marker, and was announced as a retired model pin. That is the
 * failure mode a daily gate can least afford: cry wolf on a healthy repo and
 * the reader learns to skim the report, taking the next real outage with it.
 *
 * Note where this lands such an id: `unattributed` — reported, not judged.
 * Never dropped. For `GPT-4o` that bucket is also literally correct, since it
 * IS an OpenAI product name and OpenAI is a vendor we do not query.
 */
const LOWERCASE_ONLY_VENDORS = new Set(["groq", "openrouter"]);

/** Could this id ever have been served by this vendor? */
export function possibleAt(vendorId, id) {
  return !(LOWERCASE_ONLY_VENDORS.has(vendorId) && /[A-Z]/.test(id));
}

export function judge(findings, live) {
  return findings.map((f) => {
    if (!f.vendor) return { ...f, state: "unattributed" };
    // Attribution put it here, but the vendor could never have served it, so
    // the attribution is what is wrong. Report it; do not assert a retirement.
    if (!possibleAt(f.vendor, f.id)) return { ...f, vendor: null, state: "unattributed" };
    const set = live.get(f.vendor);
    if (!set) return { ...f, state: "unchecked" };
    return { ...f, state: set.has(f.id) ? "ok" : "gone" };
  });
}

// ── Reading the fleet ────────────────────────────────────────────────────────

/**
 * Which files get opened when a repo has more candidates than the cap allows.
 *
 * Ranked, never arbitrary: a file that names a vendor or an AI concern outranks
 * a generic `config.ts`, so the cap sheds the least likely candidates first.
 * And every truncation is RECORDED — a bounded sweep that stays quiet about
 * what it skipped reads exactly like a sweep that found nothing.
 */
const truncated = [];

/** Did the token that listed the fleet see any private repo? See remoteRepos. */
let privateVisible = true;

function rank(paths, repoName) {
  const sorted = [...paths].sort((a, b) => {
    const ta = isLikelyPath(a) ? 0 : 1;
    const tb = isLikelyPath(b) ? 0 : 1;
    return ta - tb || a.length - b.length;
  });
  if (sorted.length > MAX_FILES_PER_REPO) {
    // What was dropped matters more than how many. Everything in the LIKELY
    // tier is opened first, so a truncation that sheds only generic config
    // files has not touched the audit's real coverage — and saying which it was
    // is the difference between a caveat and an alarm.
    const likelyDropped = sorted.slice(MAX_FILES_PER_REPO).filter((p) => isLikelyPath(p)).length;
    truncated.push({ repo: repoName, seen: sorted.length, opened: MAX_FILES_PER_REPO, likelyDropped });
  }
  return sorted.slice(0, MAX_FILES_PER_REPO);
}

async function gh(args) {
  const { stdout } = await exec("gh", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Remote, default-branch view. Clones drift; this repo has been bitten by that. */
async function remoteRepos() {
  const raw = await gh([
    "repo", "list", OWNER,
    "--limit", String(GH_LIMIT),
    "--no-archived",
    "--json", "name,defaultBranchRef,isFork,visibility",
  ]);
  const all = JSON.parse(raw).filter((r) => !r.isFork && r.defaultBranchRef?.name);

  // A workflow's default GITHUB_TOKEN is scoped to its own repo, so `repo list`
  // returns only PUBLIC ones — and a sweep that silently sees fewer repos than
  // it did yesterday reports a cleaner fleet, not a smaller one. Detectable
  // without knowing the true count: zero private repos in the answer means
  // either there are none, or this token cannot see them.
  privateVisible = all.some((r) => r.visibility && r.visibility !== "PUBLIC");

  return all.map((r) => ({ name: r.name, branch: r.defaultBranchRef.name }));
}

async function remoteFiles(repo) {
  let tree;
  try {
    tree = JSON.parse(
      await gh(["api", `repos/${OWNER}/${repo.name}/git/trees/${repo.branch}?recursive=1`]),
    );
  } catch {
    return []; // empty repo, or no access — not a finding
  }
  const all = (tree.tree ?? [])
    .filter((n) => n.type === "blob" && !SKIP_PATH.test("/" + n.path) && isCandidatePath(n.path))
    .map((n) => n.path);
  const paths = rank(all, repo.name);

  const out = [];
  for (const path of paths) {
    try {
      const body = JSON.parse(
        await gh(["api", `repos/${OWNER}/${repo.name}/contents/${path}?ref=${repo.branch}`]),
      );
      if (body.encoding !== "base64" || !body.content) continue;
      out.push({ path, text: Buffer.from(body.content, "base64").toString("utf8") });
    } catch {
      /* a path that vanished between tree and read is not a finding */
    }
  }
  return out;
}

function localRepos() {
  return readdirSync(FLEET_ROOT)
    .filter((n) => !n.startsWith("_") && existsSync(join(FLEET_ROOT, n, ".git")))
    .map((name) => ({ name, branch: "(local)" }));
}

function walk(dir, depth, acc) {
  if (depth < 0 || acc.length >= MAX_FILES_PER_REPO * 6) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|dist|build|\.next|coverage|\.git|\.claude)$/.test(e.name)) continue;
      walk(full, depth - 1, acc);
    } else if (isCandidatePath(full) && !SKIP_PATH.test(full)) {
      try {
        if (statSync(full).size < 400_000) acc.push(full);
      } catch { /* raced */ }
    }
  }
  return acc;
}

function localFiles(repo) {
  const root = join(FLEET_ROOT, repo.name);
  const all = walk(root, 6, []).map((full) => full.slice(root.length + 1));
  return rank(all, repo.name).map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
}

// ── The catalogue, via ai-kit ─────────────────────────────────────────────

function loadAiKit() {
  const candidates = [
    process.env.AI_KIT_FROM,
    // Renamed from ai-ration in v0.3.0. The old paths stay in the list so a
    // checkout that has not been renamed still resolves — a rename should not
    // turn a working audit into a silent exit 2.
    process.env.AI_RATION_FROM,
    join(homedir(), "dev", "fleetcrown"),
    join(homedir(), "dev", "ai-kit"),
    join(homedir(), "dev", "ai-ration"),
  ].filter(Boolean);

  for (const root of candidates) {
    for (const entry of [
      join(root, "node_modules", "ai-kit", "dist", "index.js"),
      join(root, "node_modules", "ai-ration", "dist", "index.js"),
      join(root, "dist", "index.js"),
    ]) {
      if (existsSync(entry)) return import(entry);
    }
  }
  console.error(
    "\u2717 ai-kit not found. Set AI_KIT_FROM=/path/to/a/repo that installs it,\n" +
      "  or build it once: (cd ~/dev/ai-kit && npm i && npm run build)",
  );
  process.exit(2);
}

/**
 * Ask each vendor what it still lists, for exactly the ids we found.
 * Returns Map(vendorId -> Set|null), where null means "could not look".
 */
async function readCatalogues(byVendor, checkCatalog) {
  const live = new Map();
  for (const vendor of VENDORS) {
    if (!vendor.queryable) continue;
    const findings = byVendor.get(vendor.id);
    if (!findings?.length) continue;

    const ids = [...new Set(findings.map((f) => f.id))];
    const [verdict] = await checkCatalog([
      {
        id: vendor.id,
        baseUrl: vendor.baseUrl,
        keyEnv: vendor.keyEnv,
        models: ids,
        dailyTokens: 0,
      },
    ]);
    live.set(vendor.id, verdict.live ? new Set(verdict.live) : null);
  }
  return live;
}

// ── Report ───────────────────────────────────────────────────────────────────

function report(judged) {
  const gone = judged.filter((j) => j.state === "gone");
  const unchecked = judged.filter((j) => j.state === "unchecked");
  const unattributed = judged.filter((j) => j.state === "unattributed");
  const ok = judged.filter((j) => j.state === "ok");

  const lines = [];

  if (gone.length) {
    lines.push("RETIRED — the vendor no longer lists these, so every call using them fails:");
    const byId = new Map();
    for (const g of gone) {
      const key = `${g.vendor}/${g.id}`;
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key).push(`${g.repo}:${g.path}:${g.line}`);
    }
    for (const [key, sites] of [...byId].sort()) {
      lines.push(`  GONE  ${key}`);
      for (const s of sites.sort()) lines.push(`          ${s}`);
    }
    lines.push("");
  }

  if (unchecked.length) {
    const vendors = [...new Set(unchecked.map((u) => u.vendor))].sort();
    lines.push(
      `${unchecked.length} pin(s) UNCHECKED — no readable catalogue for: ${vendors.join(", ")}.`,
    );
    lines.push("  That is not a pass for them. Set the vendor key to judge these.");
    lines.push("");
  }

  if (unattributed.length) {
    const ids = [...new Set(unattributed.map((u) => u.id))].sort();
    lines.push(`${unattributed.length} pin(s) not attributable to a vendor we query — listed, not judged:`);
    for (const id of ids.slice(0, 20)) lines.push(`  ?     ${id}`);
    if (ids.length > 20) lines.push(`  ?     … and ${ids.length - 20} more`);
    lines.push("");
  }

  lines.push(
    `${ok.length} pin(s) confirmed live · ${gone.length} retired · ` +
      `${unchecked.length} unchecked · ${unattributed.length} unattributed`,
  );

  if (truncated.length) {
    lines.push("");
    const blind = truncated.filter((t) => t.likelyDropped > 0);
    lines.push(`COVERAGE — ${truncated.length} repo(s) had more candidate files than the cap of ${MAX_FILES_PER_REPO}:`);
    for (const t of truncated) {
      const tail = t.likelyDropped > 0 ? `, ${t.likelyDropped} of them likely-AI` : ", none likely-AI";
      lines.push(`  ${t.repo}: opened ${t.opened} of ${t.seen}${tail}`);
    }
    lines.push(
      blind.length
        ? "  Files naming an AI concern were dropped — raise MAX_FILES_PER_REPO."
        : "  Only generic config files were dropped; every likely-AI file was opened.",
    );
  }

  if (gone.length) {
    lines.push("");
    lines.push("A pin is a scheduled outage. The durable fix is a chain across VENDORS —");
    lines.push("see SHARED.md → ai-kit. Repinning buys time until the next retirement.");
  }

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function main() {
  const { checkCatalog } = await loadAiKit();

  const repos = LOCAL ? localRepos() : await remoteRepos();
  const findings = [];

  for (const repo of repos) {
    const files = LOCAL ? localFiles(repo) : await remoteFiles(repo);
    for (const file of files) {
      for (const pin of extractPins(file.text)) {
        findings.push({
          repo: repo.name,
          path: file.path,
          line: pin.line,
          id: pin.id,
          vendor: attribute(file.text, pin.line),
        });
      }
    }
  }

  const { byVendor } = collate(findings);
  const live = await readCatalogues(byVendor, checkCatalog);
  const judged = judge(findings, live);

  console.log(report(judged));
  console.log(`\ninspected ${repos.length} repo(s)${LOCAL ? " (local checkouts)" : " on their default branches"}`);
  if (!LOCAL && !privateVisible) {
    console.log(
      "NOTE — no private repo was listed. Either there are none, or this token\n" +
        "       cannot see them; a repo-scoped GITHUB_TOKEN cannot. Set GH_TOKEN to a\n" +
        "       PAT with repo scope to audit private repos too.",
    );
  }

  const dead = judged.some((j) => j.state === "gone");
  process.exit(dead && !WARN_ONLY ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✗ audit failed: ${err?.message ?? err}`);
    process.exit(2);
  });
}
