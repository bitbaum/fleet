#!/usr/bin/env node
// Fleet audit: does what our sites SERVE still say what is true?
//
//   live-claims-audit.mjs [--check] [--emit-baseline] [--list] [--fixture FILE]
//   SITES=heidi,loki live-claims-audit.mjs        only these map slugs
//
// WHY
//
// Code moves; a page that was right when it shipped keeps saying the same
// thing forever. org-drift-audit.sh reads the files in a repo, but most of what
// a visitor reads is rendered from components, message catalogues and a CMS —
// nowhere a grep over *.md can see. On 2026-10-19 the live pages still linked a
// retired host and the repo descriptions still called the org something the
// register forbids. Nothing looked at the page as the visitor gets it.
//
// WHAT IS CHECKED — only what a machine can know is wrong
//
//   retired     a form registers/retired.json has retired (host, name, repo,
//               handle), anywhere in the served HTML, links included
//   claim       a pattern in registers/org.json → forbiddenClaims
//   copyright   "© 2025" (or "2023–2025") when it is 2026: the page says out
//               loud that nobody has touched it this year
//   dead-link   a same-site link on a checked page that answers 404/410
//
// Never judged: tone, design, whether copy is good. A gate that guesses at
// prose gets muted.
//
// WHICH PAGES
//
//   Every project in Loki's fleet map with a live URL (the same list the studio
//   site renders), its home page plus up to PAGES (default 8) same-site links
//   the home page itself offers — what a visitor would click first. Public GET
//   only; anything matching DENY (api, admin, auth, account …) is never
//   requested. No clicks, no forms, no AI.
//
// THE BASELINE IS A RATCHET — findings per site may fall or hold, never rise.
// live-claims.baseline is that count. Exit 2 if the map cannot be read: a
// fleet we could not look at is never reported as a clean fleet.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MAP_URL = process.env.MAP_URL ?? "https://loki.orangecat.ch/api/fleet/map";
const RETIRED_PATH = process.env.RETIRED ?? join(here, "../../registers/retired.json");
const REGISTER_PATH = process.env.REGISTER ?? join(here, "../../registers/org.json");
const BASELINE_PATH = process.env.BASELINE ?? join(here, "live-claims.baseline");
const PAGES = Number(process.env.PAGES ?? 8);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000);

export const DENY =
  /^\/(?:api|admin|auth|login|logout|signin|sign-in|signup|sign-up|register|account|settings|dashboard|cron|jobs?|internal|webhooks?|_next|private|cdn-cgi)(?:[/?#]|$)/i;

// ------------------------------------------------------------- pure helpers

/** Visible text of a page: no scripts, styles, comments or tags. */
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&copy;|&#169;|&#xa9;/gi, "©")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Same-site hrefs on a page, as absolute URLs, de-duplicated, in order. */
export function sameSiteLinks(html, base) {
  const origin = new URL(base).origin;
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)(?:#[^"']*)?["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
    if (DENY.test(u.pathname) || /\.(pdf|zip|png|jpe?g|svg|webp|gif|ico|xml|txt|json|mp4|mp3)$/i.test(u.pathname)) continue;
    u.hash = "";
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** A © year that is behind the current one. Ranges count by their end. */
export function staleCopyright(text, year) {
  const out = [];
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)\s*(?:20\d\d\s*[–—-]\s*)?(20\d\d)\b/gi)) {
    const y = Number(m[1]);
    if (y < year && !out.includes(m[0].trim())) out.push(m[0].trim());
  }
  return out;
}

export function parseRetired(json) {
  try { return (JSON.parse(json).retired ?? []).filter((r) => r.from && r.from.length >= 5); }
  catch { return []; }
}

export function parseClaims(json) {
  try {
    return (JSON.parse(json).forbiddenClaims ?? []).map((c) => ({ re: new RegExp(c.pattern, "i"), pattern: c.pattern, why: c.why }));
  } catch { return []; }
}

/**
 * The judgement for one page, isolated from the network so it can be tested.
 * Returns findings without a site; the caller adds it.
 */
export function judgePage({ url, html, year, retired, claims }) {
  const findings = [];
  const text = visibleText(html);
  // Retired forms are checked in the RAW html too: a retired host in an href
  // is the commonest form, and it is invisible in the text.
  for (const r of retired) {
    if (html.includes(r.from)) findings.push({ url, kind: "retired", token: r.from, detail: `serves retired "${r.from}" — say "${r.to}"` });
  }
  for (const c of claims) {
    const m = text.match(c.re);
    if (m) findings.push({ url, kind: "claim", token: m[0], detail: `says "${m[0]}" — ${c.why}` });
  }
  for (const c of staleCopyright(text, year)) {
    findings.push({ url, kind: "copyright", token: c, detail: `shows "${c}" in ${year}` });
  }
  return findings;
}

export function parseBaseline(text) {
  const m = new Map();
  for (const line of (text ?? "").split("\n")) {
    const t = line.replace(/#.*/, "").trim();
    if (!t) continue;
    const [site, n] = t.split(/\s+/);
    if (site && /^\d+$/.test(n ?? "")) m.set(site, Number(n));
  }
  return m;
}

export function regressions(counts, baseline) {
  return [...counts]
    .filter(([site, n]) => n > (baseline.get(site) ?? 0))
    .map(([site, n]) => ({ site, n, allowed: baseline.get(site) ?? 0 }))
    .sort((a, b) => a.site.localeCompare(b.site));
}

/** Sites from the fleet map: slug + live URL, one per distinct origin. */
export function sitesFromMap(map) {
  const seen = new Set();
  const out = [];
  for (const p of map?.projects ?? []) {
    const live = p?.urls?.live;
    if (!live || !/^https?:\/\//.test(live)) continue;
    let origin;
    try { origin = new URL(live).origin; } catch { continue; }
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push({ slug: p.slug, url: live });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ------------------------------------------------------------- I/O

async function get(url, method = "GET") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method, redirect: "follow", signal: ctl.signal, headers: { "user-agent": "bitbaum-fleet-live-claims/1 (+https://github.com/bitbaum/fleet)" } });
    const body = method === "GET" && /text\/html/.test(r.headers.get("content-type") ?? "") ? await r.text() : "";
    return { status: r.status, url: r.url, body };
  } catch (e) {
    return { status: 0, url, body: "", error: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

async function auditSite(site, ctx) {
  const findings = [];
  const home = await get(site.url);
  if (!home.status || home.status >= 500) return { findings, unreachable: true, pages: 0 };
  const pages = [{ url: home.url, html: home.body }];
  const links = sameSiteLinks(home.body, home.url).slice(0, PAGES);
  for (const l of links) {
    const r = await get(l);
    if (r.status === 404 || r.status === 410) {
      findings.push({ url: home.url, kind: "dead-link", token: new URL(l).pathname, detail: `links to ${new URL(l).pathname}, which answers ${r.status}` });
      continue;
    }
    if (r.status >= 200 && r.status < 300 && r.body && new URL(r.url).origin === new URL(home.url).origin) pages.push({ url: r.url, html: r.body });
  }
  const dedup = new Set();
  for (const p of pages) {
    for (const f of judgePage({ ...p, ...ctx })) {
      // One finding per site per (kind, token): the same footer on every page
      // is one thing to fix, not nine.
      const k = `${f.kind}|${f.token}`;
      if (dedup.has(k)) continue;
      dedup.add(k);
      findings.push(f);
    }
  }
  return { findings, unreachable: false, pages: pages.length };
}

async function main() {
  const args = process.argv.slice(2);
  const fixture = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;
  let map;
  try {
    map = fixture ? JSON.parse(readFileSync(fixture, "utf8")) : await (await fetch(MAP_URL)).json();
  } catch (e) {
    console.error(`could not read the fleet map (${MAP_URL}): ${e.message}`);
    process.exit(2);
  }
  const only = (process.env.SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sites = sitesFromMap(map).filter((s) => !only.length || only.includes(s.slug));
  if (!sites.length) { console.error("the fleet map lists no live sites"); process.exit(2); }

  const ctx = {
    year: new Date().getUTCFullYear(),
    retired: existsSync(RETIRED_PATH) ? parseRetired(readFileSync(RETIRED_PATH, "utf8")) : [],
    claims: existsSync(REGISTER_PATH) ? parseClaims(readFileSync(REGISTER_PATH, "utf8")) : [],
  };
  const counts = new Map();
  const all = [];
  const unreachable = [];
  for (const s of sites) {
    const r = await auditSite(s, ctx);
    if (r.unreachable) { unreachable.push(s.slug); continue; }
    counts.set(s.slug, r.findings.length);
    for (const f of r.findings) all.push({ site: s.slug, ...f });
  }

  console.log(`${sites.length} live site(s), ${all.length} finding(s)${unreachable.length ? `; unreachable: ${unreachable.join(", ")}` : ""}`);
  for (const [site, n] of [...counts].filter(([, n]) => n).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${site}`);
  if (args.includes("--list") || args.includes("--check")) {
    for (const f of all) console.log(`  ${f.site}  [${f.kind}] ${f.detail}  (${f.url})`);
  }
  if (args.includes("--emit-baseline")) {
    const body = [...counts].filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join("\n");
    writeFileSync(BASELINE_PATH, `# live-claims: findings per site. May fall or hold, never rise.\n# GENERATED by live-claims-audit.mjs --emit-baseline\n${body}${body ? "\n" : ""}`);
    console.log(`wrote ${BASELINE_PATH}`);
  }
  if (args.includes("--check")) {
    if (unreachable.length === sites.length) { console.error("no site reachable"); process.exit(2); }
    const reg = regressions(counts, parseBaseline(existsSync(BASELINE_PATH) ? readFileSync(BASELINE_PATH, "utf8") : ""));
    if (reg.length) {
      console.log(`✗ served pages drifted:\n${reg.map((r) => `  ${r.site}: ${r.n} (baseline ${r.allowed})`).join("\n")}`);
      process.exit(1);
    }
    console.log("✓ no live site says more that is untrue than its baseline allows");
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
