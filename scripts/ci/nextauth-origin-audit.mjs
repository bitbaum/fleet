#!/usr/bin/env node
/**
 * Fleet audit: a next-auth app that advertises the WRONG ORIGIN.
 *
 * WHY THIS EXISTS
 * ---------------
 * Behind Caddy, a Next.js app never sees its own public URL. next-auth
 * resolves relative redirects against whatever origin the request arrived on
 * — for a reverse-proxied app that is the INTERNAL one — unless NEXTAUTH_URL
 * (v4) / AUTH_URL (v5) is pinned in the box env. `AUTH_TRUST_HOST=true` does
 * NOT cover this path, which is exactly what makes a broken app look
 * configured: the variable that sounds like the fix is present and the app is
 * still wrong.
 *
 * The symptom is not a 500. Everything renders. Only the OAuth callback and
 * the sign-out target carry `https://localhost:<port>`, so Google sign-in can
 * never complete and sign-out lands on a dead page — a break that reaches the
 * user and nothing else.
 *
 * THIS IS THE SECOND TIME. petvity shipped it, it was fixed in petvity#39 on
 * ~2026-08-14, a per-app walkthrough assertion was supposedly added — and on
 * 2026-09-10 petvity was serving `https://localhost:4013/api/auth/callback/
 * google` in production again. The regression sat there advertising itself in
 * public JSON for weeks and nothing looked. A fix that can silently revert is
 * not a fix; this is the check that ends the class.
 *
 * WHAT IT READS
 * -------------
 * next-auth publishes `GET /api/auth/providers` unauthenticated, and every
 * entry carries `signinUrl` and `callbackUrl` built from the app's CONFIGURED
 * origin. That is the misconfiguration, verbatim, from outside — no secret, no
 * login, no box access. If those URLs are right, this class of bug is absent.
 *
 * THE SITE LIST IS THE FLEET'S OWN, NOT A SECOND COPY
 * ---------------------------------------------------
 * Sites are discovered from fleetcrown's public footer, the same SSOT
 * ui-defect-audit.mjs reads (config/fleet-sites.ts renders there precisely so
 * each site has a crawlable anchor). A new site is audited the day it is
 * linked and a retired one stops being audited, with nobody editing this file.
 * It also means a repo that is not a deployment — fleetcrown-scripts is a
 * second checkout of fleetcrown, not a site — is absent by construction rather
 * than by an exclusion list somebody has to maintain.
 *
 * VERDICTS, AND WHY EACH ONE
 * --------------------------
 *   PASS  every signinUrl/callbackUrl origin equals the origin that served
 *         the JSON.
 *   FAIL  any of them does not — localhost, an internal port, a foreign host.
 *   FAIL  the endpoint answers 5xx. A next-auth app that cannot answer is
 *         broken too, and 500 here is its own signature: datacat's authOptions
 *         is missing `secret:`, so /api/auth/* 500s while the site renders.
 *         Treating that as "no data, move on" is how the check would report a
 *         healthy fleet over a dead auth.
 *   SKIP  404 — the site is not a next-auth app. Most of the fleet is not.
 *   SKIP  200 that is not a providers object (a catch-all page, not a route).
 *   SKIP  unreachable / DNS failure. "I could not look" is not "it is fine",
 *         but a site that is down is the uptime checks' class, not this one —
 *         it is printed as its own row so it is never read as a pass.
 *
 * The expected origin is the origin of the FINAL response (redirects
 * followed), so a site that legitimately redirects — aoz-wohnen → aoz — is
 * judged against the host that actually served it, not the one we asked for.
 *
 * Usage:
 *   node scripts/ci/nextauth-origin-audit.mjs               # exit 1 on any FAIL
 *   node scripts/ci/nextauth-origin-audit.mjs --warn-only   # report, always exit 0
 *   SITES="https://a.example,https://b.example" node scripts/ci/nextauth-origin-audit.mjs
 */

const WARN_ONLY = process.argv.includes("--warn-only");
const DISCOVERY_URL = process.env.DISCOVERY_URL ?? "https://fleetcrown.orangecat.ch/";
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 20000);

/** The fleet's own list of the sites it runs, read from where it is published. */
export async function discoverSites(fetchImpl = fetch) {
  const explicit = process.env.SITES?.trim();
  if (explicit) return explicit.split(",").map((s) => s.trim()).filter(Boolean);

  const res = await fetchImpl(DISCOVERY_URL, { headers: { "user-agent": "fleet-nextauth-audit" } });
  if (!res.ok) throw new Error(`site discovery failed: ${DISCOVERY_URL} → ${res.status}`);
  const html = await res.text();
  const found = new Set();
  for (const m of html.matchAll(/https:\/\/[a-z0-9.-]*orangecat\.ch(?=["'/\s<])/g)) {
    found.add(m[0]);
  }
  found.add("https://fleetcrown.orangecat.ch");
  return [...found].sort();
}

/** Every http(s) URL a providers payload advertises, with the key that held it. */
export function advertisedUrls(payload) {
  const out = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return out;
  for (const [id, provider] of Object.entries(payload)) {
    if (!provider || typeof provider !== "object") continue;
    for (const key of ["signinUrl", "callbackUrl"]) {
      const value = provider[key];
      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        out.push({ provider: id, key, url: value });
      }
    }
  }
  return out;
}

/** A providers payload is an object of provider objects that advertise URLs. */
export function looksLikeProviders(payload) {
  return advertisedUrls(payload).length > 0;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The whole decision, as a pure function of one probe — so the self-test can
 * pin both sides from captured payloads with no network at all.
 *
 * probe: { site, status, finalUrl, payload, body, error }
 */
export function judge(probe) {
  const { site, status, finalUrl, payload, error } = probe;

  if (error || status === 0) {
    return { site, state: "skip", detail: `unreachable (${error ?? "no response"}) — uptime's class, not this one` };
  }
  if (status === 404 || status === 410) {
    return { site, state: "skip", detail: "no /api/auth/providers — not a next-auth app" };
  }
  if (status >= 500) {
    return {
      site,
      state: "fail",
      detail: `/api/auth/providers → ${status} — next-auth is installed and cannot answer`,
    };
  }
  if (status !== 200) {
    return { site, state: "fail", detail: `/api/auth/providers → ${status} — unexpected for a public endpoint` };
  }
  if (!looksLikeProviders(payload)) {
    return { site, state: "skip", detail: "200 but not a providers object — catch-all page, not a route" };
  }

  const expected = originOf(finalUrl ?? site);
  if (!expected) {
    return { site, state: "fail", detail: `cannot read an origin from ${finalUrl ?? site}` };
  }

  const wrong = advertisedUrls(payload).filter((u) => originOf(u.url) !== expected);
  if (wrong.length === 0) {
    const n = advertisedUrls(payload).length;
    return { site, state: "pass", expected, detail: `${n} URL(s) on ${expected}` };
  }
  const shown = wrong.slice(0, 3).map((u) => `${u.provider}.${u.key}=${u.url}`).join("  ");
  const more = wrong.length > 3 ? `  (+${wrong.length - 3} more)` : "";
  return {
    site,
    state: "fail",
    expected,
    detail: `advertises a foreign origin; expected ${expected} — ${shown}${more}`,
  };
}

export async function probe(site, fetchImpl = fetch) {
  const url = `${site.replace(/\/$/, "")}/api/auth/providers`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": "fleet-nextauth-audit", accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { site, status: 0, error: err?.message ?? String(err) };
  }
  const body = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    /* HTML or empty — judge() decides from status + payload===null */
  }
  return { site, status: res.status, finalUrl: res.url || url, payload, body };
}

const MARK = { pass: "✓", fail: "✗", skip: "⊘" };

export function report(rows) {
  const width = Math.max(...rows.map((r) => r.site.length), 4);
  const lines = ["", "  next-auth advertised origin", ""];
  for (const r of rows) {
    lines.push(`  ${MARK[r.state]} ${r.site.padEnd(width)}  ${r.state.toUpperCase().padEnd(4)}  ${r.detail}`);
  }
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of rows) counts[r.state]++;
  lines.push("");
  lines.push(`  ${counts.pass} pass · ${counts.fail} fail · ${counts.skip} skip · ${rows.length} site(s)`);
  if (counts.fail) {
    lines.push("");
    lines.push("  A wrong origin here means OAuth sign-in cannot complete and sign-out");
    lines.push("  lands on a dead page. Fix: pin NEXTAUTH_URL (v4) or AUTH_URL (v5) to the");
    lines.push("  public origin in the app's env on the box, then restart the unit.");
    lines.push("  AUTH_TRUST_HOST=true does NOT cover this path.");
  }
  return lines.join("\n");
}

export async function main() {
  const sites = await discoverSites();
  const rows = [];
  for (const site of sites) {
    rows.push(judge(await probe(site)));
  }
  console.log(report(rows));
  const failed = rows.some((r) => r.state === "fail");
  process.exit(failed && !WARN_ONLY ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✗ audit failed: ${err?.message ?? err}`);
    process.exit(2);
  });
}
