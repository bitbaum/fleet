#!/usr/bin/env node
/**
 * Auth parity, live: which sign-in methods each app's sign-in page offers,
 * and whether the ones it offers work as far as a stranger can tell.
 *
 * The owner's rule (2026-11-01): every app offers every method on every auth
 * page. This check reports, per app in auth-parity.apps.json:
 *
 *   EP   email + password          ML   emailed sign-in link (or code)
 *   PK   passkey                   2FA  TOTP second factor (server only)
 *   REC  password recovery         OC   Continue with OrangeCat
 *   MOR  Continue with Google, Apple, GitHub, X or Facebook (Morulia)
 *   LN   Lightning login (LNURL-auth, AccountKit 0.26.1+, ACCOUNTKIT_LIGHTNING)
 *
 * Two readings per method:
 *   configured  what the server says it serves: better-auth endpoints that
 *               answer instead of 404 (accountkit), or the provider list
 *               (Auth.js and AccountKit's Auth.js bridge). null = no way to
 *               ask this runtime, so the page decides.
 *   shown       what headless Chromium at 390px finds on the sign-in page.
 *
 * It FAILS on a method that is configured but not shown, on one that is shown
 * but broken (an OIDC authorize request the IdP refuses, a recovery link that
 * does not load, an OIDC button whose provider is not mounted), and on a
 * sign-in page that does not load. A method that is neither configured nor
 * shown is reported and does not fail: it is not switched on yet.
 *
 * An app marked `standard` (AccountKit's own screens) is held to more: every
 * method but MOR is on, they are drawn in AccountKit's order, and the links
 * between sign-in and sign-up say AccountKit's own words ("Create an account",
 * "Sign in", in the page's language), read from the published package, never
 * from a copy here. MOR waits for Morulia's first provider, as everywhere.
 * An app marked `served: false` is listed and not probed (keller#9).
 *
 * SAFETY (the probe method of docs/auth-parity-2026-10-30.md): read-only.
 * No account is created, no credential is submitted and no mail is sent. The
 * server probes send empty bodies, which better-auth rejects at validation
 * before it does anything; the OIDC probe stops at the authorize leg: it asks
 * for the IdP's authorize URL and requests it once WITHOUT following it.
 * No click is made in the browser.
 *
 * Usage:
 *   node scripts/ci/auth-parity.mjs [--out DIR] [--only a,b]
 *   PLAYWRIGHT_FROM=/dir/with/node_modules/playwright
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APPS_PATH = join(HERE, "auth-parity.apps.json");
export const METHODS = ["EP", "ML", "PK", "2FA", "REC", "OC", "MOR", "LN"];
/** 2FA is asked for after the password, never on the sign-in page itself. */
const SERVER_ONLY = new Set(["2FA"]);
const UA = "fleet-auth-parity (read-only; bitbaum/fleet scripts/ci/auth-parity.mjs)";
const TIMEOUT = 20_000;

/** What the page's clickable text has to say for each method (en/de/fr/it). */
export const PATTERNS = {
  OC: /orange\s?cat/i,
  MOR: /\b(google|apple|github|facebook)\b/i,
  PK: /pass\s?key|zugangsschl|cl[ée] d.acc[eè]s|chiave d.accesso/i,
  ML: /(sign-?in|log-?in|anmelde|magic|e-?mail)[ -]?(link|code)|link (per|by|via) e-?mail|lien de connexion|mit code|login code|anmeldecode|sign-?in code/i,
  REC: /forgot|vergessen|oubli[ée]|dimenticat|reset/i,
  LN: /lightning/i,
  EP: /password|passwort|mot de passe/i,
};

const RECOVERY_HREF = /forgot|reset-?password|recover|passwort-vergessen/i;

/** What an app on AccountKit's screens offers, and the order its SignInForm draws them in. */
export const STANDARD_METHODS = ["EP", "ML", "PK", "2FA", "REC", "OC"];
export const STANDARD_ORDER = ["OC", "PK", "ML", "REC"];

const pathOf = (href) => {
  try {
    return new URL(href, "https://x.invalid").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
};

/**
 * Where a page on the standard departs from it. `words` holds AccountKit's
 * labels for every locale ({ createAccount: Set, signIn: Set }), or null when
 * the package could not be loaded (then wording is not judged).
 */
export function standardFailures({ app, methods, signIn, signUp, words }) {
  const out = [];
  for (const m of STANDARD_METHODS) {
    const state = methods[m]?.state;
    if (state !== "ok" && state !== "shown") out.push(`${m} is ${state === "off" ? "off" : state}, below the standard`);
  }
  const at = STANDARD_ORDER.map((m) => [m, signIn.clickables.findIndex((t) => PATTERNS[m].test(t))]).filter(
    ([, i]) => i >= 0,
  );
  for (let k = 1; k < at.length; k++)
    if (at[k][1] < at[k - 1][1]) {
      out.push(`${at[k][0]} comes before ${at[k - 1][0]}; AccountKit's order is ${STANDARD_ORDER.join(", ")}`);
      break;
    }
  if (!words) return out;
  const switchLink = (page, to, allowed, name) => {
    if (!page || !to) return;
    const target = pathOf(to);
    const link = (page.links ?? []).find((l) => pathOf(l.href) === target);
    if (!link) out.push(`no link to ${to} on the ${name} page`);
    else if (!allowed.has(link.text)) out.push(`the link to ${to} says "${link.text}", not AccountKit's words`);
  };
  switchLink(signIn, app.signUp, words.createAccount, "sign-in");
  switchLink(signUp, app.signIn, words.signIn, "sign-up");
  return out;
}

/**
 * AccountKit's own words for every locale it ships, from the installed
 * package (the workflow installs it beside playwright). null when absent.
 */
export async function loadStandardWords(roots) {
  for (const root of roots) {
    const pkgDir = join(root, "node_modules", "@bitbaum", "accountkit");
    if (!existsSync(join(pkgDir, "package.json"))) continue;
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const entry = pkg.exports?.["./auth"];
    const file = typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
    if (!file) continue;
    const m = await import(join(pkgDir, typeof file === "string" ? file : file.default));
    const words = { createAccount: new Set(), signIn: new Set() };
    for (const locale of m.AUTH_LABEL_LOCALES) {
      const l = m.authLabelsFor(locale);
      words.createAccount.add(l.createAccount);
      words.signIn.add(l.signIn);
    }
    return words;
  }
  return null;
}

/* ----------------------------- classification ---------------------------- */

/**
 * The verdict for one method. `c` = configured (true/false/null), `shown`
 * (boolean, or null when it cannot appear on a page), `broken` (a reason or
 * null). Returns { state, fail }: state is one of ok, missing, broken,
 * off, shown (shown on a runtime that cannot say whether it is configured).
 */
export function verdict({ c, shown, broken }) {
  if (shown && broken) return { state: "broken", fail: true };
  if (c === true && shown === false) return { state: "missing", fail: true };
  if (shown === null) return { state: c ? "ok" : "off", fail: false };
  if (shown) return { state: c === null ? "shown" : "ok", fail: false };
  return { state: "off", fail: false };
}

const PROVIDER_NAMES = /\b(google|apple|github|facebook)\b/gi;

/**
 * What the page shows, from the visible texts and inputs Chromium found.
 * `ownProviders` are providers a product signs in with through its own
 * registered app (Loki's GitHub, AccountKit `githubSignIn`): a button that
 * names only those is the product's own, not Morulia's.
 */
export function shownMethods(ui, { ownProviders = [] } = {}) {
  const own = new Set(ownProviders.map((p) => p.toLowerCase()));
  const notOwn = (t) => [...t.matchAll(PROVIDER_NAMES)].some(([name]) => !own.has(name.toLowerCase()));
  const texts = ui.clickables.join("\n");
  const shown = {};
  for (const m of ["OC", "MOR", "PK", "ML", "REC", "LN"]) shown[m] = PATTERNS[m].test(texts);
  if (own.size) shown.MOR = ui.clickables.some((t) => PATTERNS.MOR.test(t) && notOwn(t));
  // A recovery link may say only "Forgot?" or carry an icon; its address says it.
  if ((ui.links ?? []).some((l) => RECOVERY_HREF.test(new URL(l.href, "https://x").pathname))) shown.REC = true;
  shown.EP = ui.passwordInputs > 0 || PATTERNS.EP.test(texts.replace(PATTERNS.REC, ""));
  return shown;
}

/** better-auth answers a mounted endpoint with JSON; an unmounted one 404s. */
export function mounted(status, body) {
  if (status === 404) return false;
  if (!body || typeof body !== "object") return false;
  return status < 300 || body.code === "VALIDATION_ERROR" || status === 401;
}

/**
 * Whether an IdP accepted an authorize request, from its first answer.
 * OrangeCat validates client, redirect URI, PKCE and scopes before it hands a
 * signed-out visitor to /auth; Morulia does the same before its own page.
 */
export function authorizeAccepted(idp, status, location) {
  if (status >= 300 && status < 400 && location) {
    const to = new URL(location, idp);
    if (/[?&](error|authError)=/.test(to.search)) return `refused: ${to.searchParams.get("error") ?? "authError"}`;
    if (to.origin !== new URL(idp).origin) return `sent elsewhere: ${to.origin}`;
    return null;
  }
  if (status === 200) return null;
  return `answered ${status}`;
}

/* --------------------------------- HTTP ---------------------------------- */

class Jar {
  constructor() { this.c = new Map(); }
  take(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function req(url, { method = "GET", json, form, jar, origin } = {}) {
  const headers = { "user-agent": UA, accept: "application/json, text/html;q=0.5" };
  if (origin) headers.origin = origin;
  if (jar?.c.size) headers.cookie = jar.header();
  let body;
  if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  const res = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
  jar?.take(res);
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, location: res.headers.get("location"), data };
}

/** Ask the IdP once, without following: accepted (null) or why not. */
async function authorizeLeg(url) {
  const idp = new URL(url).origin;
  const r = await req(url);
  return authorizeAccepted(idp, r.status, r.location);
}

const PROVIDERS = { OC: "orangecat", MOR: "bitbaum-signin" };

/** better-auth (AccountKit) endpoints. Every body is empty: validation stops it. */
async function probeBetterAuth(app) {
  const api = `${app.origin}/api/auth`;
  const o = { origin: app.origin };
  const out = { configured: {}, legs: {} };
  const ml = await req(`${api}/sign-in/magic-link`, { method: "POST", json: {}, ...o });
  const tf = await req(`${api}/two-factor/verify-totp`, { method: "POST", json: {}, ...o });
  const pk = await req(`${api}/passkey/generate-authenticate-options`, o);
  // The wallet's callback with a malformed challenge: LUD-04's own error when
  // mounted, 404 when not. Nothing is minted.
  const ln = await req(`${api}/lightning/callback?tag=login&k1=00&sig=00&key=00`, o);
  out.configured.ML = mounted(ml.status, ml.data);
  // AccountKit offers recovery exactly when it offers the link: both need mail.
  out.configured.REC = out.configured.ML;
  out.configured["2FA"] = mounted(tf.status, tf.data);
  out.configured.PK = pk.status === 200 && Boolean(pk.data?.challenge);
  out.configured.LN = ln.status !== 404 && ln.data?.status === "ERROR";
  const anyBetterAuth = out.configured.ML || out.configured["2FA"] || out.configured.PK;
  out.configured.EP = anyBetterAuth ? true : null;
  for (const [m, provider] of Object.entries(PROVIDERS)) {
    const r = await req(`${api}/sign-in/social`, {
      method: "POST",
      json: { provider, callbackURL: "/", disableRedirect: true },
      ...o,
    });
    out.configured[m] = r.status === 200 && typeof r.data?.url === "string";
    if (out.configured[m]) out.legs[m] = await authorizeLeg(r.data.url);
    else if (!anyBetterAuth) out.configured[m] = null;
  }
  return out;
}

/** Auth.js, or AccountKit's Auth.js bridge: the provider list, then signin/<id>. */
async function probeAuthJs(app) {
  const api = `${app.origin}/api/auth`;
  const out = { configured: {}, legs: {} };
  const list = await req(`${api}/providers`);
  if (list.status !== 200 || !list.data || typeof list.data !== "object") return out;
  const providers = Object.values(list.data);
  if (providers.some((p) => p?.type === "credentials")) out.configured.EP = true;
  for (const [m, provider] of Object.entries(PROVIDERS)) {
    out.configured[m] = provider in list.data;
    if (!out.configured[m]) continue;
    const jar = new Jar();
    const csrf = await req(`${api}/csrf`, { jar });
    const signin = await req(`${api}/signin/${provider}`, {
      method: "POST",
      jar,
      origin: app.origin,
      form: { csrfToken: csrf.data?.csrfToken ?? "", callbackUrl: `${app.origin}/` },
    });
    // Auth.js redirects; AccountKit's bridge answers {url} like better-auth.
    const next = signin.location ?? (typeof signin.data?.url === "string" ? signin.data.url : null);
    const to = next ? new URL(next, app.origin) : null;
    out.legs[m] =
      to && to.origin !== new URL(app.origin).origin
        ? await authorizeLeg(to.href)
        : `signin/${provider} did not redirect to the IdP (${signin.status}${to ? ` → ${to.pathname}${to.search.includes("error") ? to.search : ""}` : ""})`;
  }
  return out;
}

async function serverProbe(app) {
  if (app.runtime === "accountkit") return probeBetterAuth(app);
  if (app.runtime === "compat") {
    const a = await probeAuthJs(app);
    const b = await probeBetterAuth(app);
    // The bridge closes better-auth's own routes; whatever answers there counts.
    for (const m of ["ML", "PK", "2FA", "REC", "LN"]) a.configured[m] = b.configured[m] ? true : null;
    return a;
  }
  if (app.runtime === "authjs") return probeAuthJs(app);
  return { configured: {}, legs: {} };
}

/* -------------------------------- browser -------------------------------- */

/** Runs in the page: visible clickable texts, visible password inputs, recovery links. */
const READ_PAGE = String.raw`(() => {
  const seen = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const label = (el) => [el.innerText, el.value, el.getAttribute("aria-label"), el.title]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  // Header, footer and nav are the site's chrome: a "GitHub" or "OrangeCat"
  // link there is not a sign-in method.
  const chrome = (el) => Boolean(el.closest("header, footer, nav, [role=contentinfo], [role=banner]"));
  const clickables = [...document.querySelectorAll('a, button, [role="button"], [role="tab"], input[type="submit"], summary')]
    .filter((el) => seen(el) && !chrome(el)).map(label).filter(Boolean);
  const passwordInputs = [...document.querySelectorAll('input[type="password"]')].filter(seen).length;
  const links = [...document.querySelectorAll("a[href]")].filter((el) => seen(el) && !chrome(el))
    .map((a) => ({ text: label(a), href: a.href }));
  return { clickables, passwordInputs, links, title: document.title };
})()`;

async function readPage(ctx, url) {
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const ui = await page.evaluate(READ_PAGE);
    return { status: res?.status() ?? 0, finalUrl: page.url(), ...ui };
  } finally {
    await page.close();
  }
}

/** Load the recovery page a shown link points at: null when it loads. */
async function recoveryLeg(ui, origin) {
  const link = ui.links.find(
    (l) => PATTERNS.REC.test(l.text) || RECOVERY_HREF.test(new URL(l.href, origin).pathname),
  );
  if (!link) return null; // shown as a button: nothing to request without a click
  const to = new URL(link.href, origin);
  if (to.origin !== new URL(origin).origin) return `points off-site: ${to.origin}`;
  let r = await req(to.href);
  for (let hops = 0; r.status >= 300 && r.status < 400 && r.location && hops < 5; hops++)
    r = await req(new URL(r.location, to).href);
  return r.status < 400 ? null : `${to.pathname} answered ${r.status}`;
}

/* --------------------------------- report -------------------------------- */

const MARK = { ok: "yes", shown: "yes", off: "—", missing: "MISSING", broken: "BROKEN" };

export function renderReport(rows, date) {
  const head = `| App | Runtime | ${METHODS.join(" | ")} | Sign-up: OC / MOR | Verdict |`;
  const sep = `|${"---|".repeat(METHODS.length + 4)}`;
  const body = rows.map((r) => {
    if (r.notServed) return `| ${r.name} | ${r.runtime} | ${METHODS.map(() => "·").join(" | ")} | · | not served (${r.notServed}) |`;
    if (r.error) return `| ${r.name} | ${r.runtime} | ${METHODS.map(() => "?").join(" | ")} | ? | FAIL: ${r.error} |`;
    const cells = METHODS.map((m) => MARK[r.methods[m].state]);
    const su = r.signUp ? `${r.signUp.OC ? "yes" : "—"} / ${r.signUp.MOR ? "yes" : "—"}` : "n/a";
    return `| ${r.name} | ${r.runtime} | ${cells.join(" | ")} | ${su} | ${r.failures.length ? "FAIL" : "pass"} |`;
  });
  const notes = rows.flatMap((r) => (r.failures ?? []).map((f) => `- **${r.name}**: ${f}`));
  return [
    `# Auth parity, live (${date})`,
    "",
    "yes = shown on the sign-in page (2FA: served). — = not configured and not shown.",
    "MISSING = configured but not shown. BROKEN = shown, but the server or IdP refuses it.",
    "· = not served, so not probed. An app on the standard (AccountKit's screens) also fails when a",
    "method other than MOR is off, out of AccountKit's order, or its sign-in/sign-up links use other words.",
    "",
    head,
    sep,
    ...body,
    "",
    notes.length ? "## Failures\n\n" + notes.join("\n") : "No failures.",
    "",
  ].join("\n");
}

/* ---------------------------------- run ---------------------------------- */

export async function probeApp(ctx, app, { words = null } = {}) {
  const row = { name: app.name, runtime: app.runtime, origin: app.origin, failures: [], methods: {} };
  if (app.served === false) return { ...row, notServed: app.note ?? "not served" };
  const signInUrl = app.origin + app.signIn;
  let ui;
  try {
    ui = await readPage(ctx, signInUrl);
  } catch (e) {
    ui = await readPage(ctx, signInUrl).catch(() => null);
    if (!ui) return { ...row, error: `sign-in page did not load (${e.message.split("\n")[0]})` };
  }
  if (ui.status >= 400) return { ...row, error: `sign-in page answered ${ui.status}` };
  const shown = shownMethods(ui, { ownProviders: app.ownProviders });
  if (app.providerButtons === "OC") {
    shown.OC = shown.OC || shown.MOR;
    shown.MOR = false;
  }
  const server = app.isOrangeCat ? { configured: {}, legs: {} } : await serverProbe(app);
  const broken = { ...server.legs };
  if (shown.REC) broken.REC = await recoveryLeg(ui, app.origin);
  for (const m of ["OC", "MOR"])
    if (shown[m] && server.configured[m] === false) broken[m] = "shown, but the server has no such provider";
  if (app.isOrangeCat) shown.OC = null; // OrangeCat is the OC IdP itself
  for (const m of METHODS) {
    const c = server.configured[m] ?? null;
    const s = SERVER_ONLY.has(m) || (m === "OC" && app.isOrangeCat) ? null : shown[m];
    const b = broken[m] ?? null;
    const v = verdict({ c, shown: s, broken: s ? b : null });
    row.methods[m] = { configured: c, shown: s, broken: b, ...v };
    if (v.state === "missing") row.failures.push(`${m} is configured but not on ${app.signIn}`);
    if (v.state === "broken") row.failures.push(`${m} is shown but broken: ${b}`);
  }
  let signUpPage = null;
  if (app.signUp) {
    try {
      const page = await readPage(ctx, app.origin + app.signUp);
      signUpPage = page;
      if (page.status >= 400) throw new Error(`answered ${page.status}`);
      const su = shownMethods(page, { ownProviders: app.ownProviders });
      if (app.providerButtons === "OC") {
        su.OC = su.OC || su.MOR;
        su.MOR = false;
      }
      row.signUp = { OC: su.OC, MOR: su.MOR };
      for (const m of ["OC", "MOR"])
        if (server.configured[m] === true && !su[m]) row.failures.push(`${m} is configured but not on ${app.signUp}`);
    } catch (e) {
      row.failures.push(`sign-up page ${app.signUp} did not load (${e.message.split("\n")[0]})`);
    }
  }
  if (app.standard)
    row.failures.push(...standardFailures({ app, methods: row.methods, signIn: ui, signUp: signUpPage, words }));
  row.clickables = ui.clickables;
  row.linksSeen = ui.links.filter((l) => /regist|sign-?up|konto|account|forgot|vergessen|reset/i.test(l.text + l.href)).map((l) => l.href);
  return row;
}

function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_FROM, process.cwd()].filter(Boolean);
  for (const root of roots) {
    const entry = join(root, "node_modules", "playwright", "index.js");
    if (existsSync(entry)) return import(entry).then((m) => m.default ?? m);
  }
  console.error("✗ playwright not found. Set PLAYWRIGHT_FROM=/dir/that/installs/it.");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : "auth-parity-report";
  const onlyIdx = args.indexOf("--only");
  const only = (onlyIdx >= 0 ? args[onlyIdx + 1] : process.env.APPS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const { apps } = JSON.parse(readFileSync(APPS_PATH, "utf8"));
  const chosen = only.length ? apps.filter((a) => only.includes(a.name)) : apps;
  const { chromium } = await loadPlaywright();
  const words = await loadStandardWords([process.env.PLAYWRIGHT_FROM, process.cwd()].filter(Boolean));
  if (!words) console.warn("! @bitbaum/accountkit not installed beside playwright: the standard's wording is not judged.");
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  const rows = [];
  for (const app of chosen) {
    let row;
    try {
      row = await probeApp(ctx, app, { words });
    } catch (e) {
      row = { name: app.name, runtime: app.runtime, error: e.message.split("\n")[0] };
    }
    if (row.error) row.failures = [row.error];
    console.log(`${row.failures.length ? "✗" : "✓"} ${app.name}${row.failures.length ? ": " + row.failures.join("; ") : ""}`);
    rows.push(row);
  }
  await browser.close();
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "auth-parity.json"), JSON.stringify({ date, rows }, null, 2));
  const md = renderReport(rows, date);
  writeFileSync(join(outDir, "auth-parity.md"), md);
  console.log("\n" + md);
  process.exit(rows.some((r) => r.failures.length) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
