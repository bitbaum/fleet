#!/usr/bin/env node
/**
 * Fleet audit: does one of OUR OWN products let people sign in some way other
 * than OrangeCat?
 *
 * WHY THIS EXISTS
 * ---------------
 * STACK.md decided on 2026-09-01 that our own products federate to OrangeCat
 * (OIDC) and keep no users, passwords or reset flows of their own. The rule
 * lived in a document, and a document does not stop drift: on 2026-09-24 Loki
 * — the product that federated FIRST — was offering four ways in (OrangeCat,
 * GitHub, Google, email+password). Each extra path is a second identity for
 * the same person, a second reset flow to secure, and a second place for a
 * sign-out to miss.
 *
 * Client-owned apps are deliberately NOT judged: their users belong to the
 * client, and STACK.md gives them their own auth (better-auth). The line is
 * OWNERSHIP, read from the provisioning register, never a list typed here.
 *
 * WHAT IT READS
 * -------------
 *   who is ours   loki's /api/fleet/map — live projects whose owner is the org,
 *                 minus demos and OrangeCat itself. NOT apps.conf: apps.conf
 *                 omits the handcrafted services, so the first draft of this
 *                 audit could not see Loki — the product that prompted it.
 *                 product-identity-audit.mjs moved to the map for the same
 *                 reason.
 *   how they      each product's public `GET /api/auth/providers`, which
 *   sign in       next-auth publishes unauthenticated: the ids of every
 *                 sign-in method the LIVE app offers. What is deployed, not
 *                 what some branch says — no source parsing, no secret.
 *
 * VERDICTS
 * --------
 *   PASS  every provider is `orangecat`.
 *   FAIL  a provider other than `orangecat` that is not in the baseline.
 *   HELD  a deviation recorded in own-product-signin.baseline. Printed on every
 *         run so it is never mistaken for a pass; the baseline may only shrink.
 *   FAIL  a baseline row whose deviation is gone — delete the row. A baseline
 *         that keeps entries nobody needs is how an allow-list quietly becomes
 *         permission for the next regression.
 *   SKIP  not a next-auth app (404), unreachable, or a 5xx. The last is a real
 *         failure but nextauth-origin-audit.mjs already fails on it; paging for
 *         it twice would teach people to ignore one of the two.
 *
 * KNOWN BLIND SPOT, STATED
 * ------------------------
 * A product on a non-next-auth stack publishes no providers list and SKIPs.
 * Today every own product is next-auth or is OrangeCat itself; if that stops
 * being true, this check cannot see it, and says so in its SKIP line.
 *
 * Usage:
 *   node scripts/ci/own-product-signin-audit.mjs              # exit 1 on FAIL
 *   node scripts/ci/own-product-signin-audit.mjs --warn-only  # report only
 *   FLEET_MAP_FILE=./map.json node scripts/ci/own-product-signin-audit.mjs
 */

import { readFileSync } from "node:fs";
import { probe } from "./nextauth-origin-audit.mjs";

const ORG = process.env.ORG || "bitbaum";
const MAP_URL = process.env.FLEET_MAP_URL || "https://loki.orangecat.ch/api/fleet/map";
const BASELINE_FILE =
  process.env.BASELINE_FILE || new URL("./own-product-signin.baseline", import.meta.url).pathname;
const WARN_ONLY = process.argv.includes("--warn-only");

/** The identity provider itself. It is not a client of itself. */
export const IDENTITY_PROVIDER_APP = "orangecat";
/** The one provider id an own product may offer. */
export const ALLOWED_PROVIDER = "orangecat";

// ── pure ────────────────────────────────────────────────────────────────────

/** Layers that are not products someone signs in to. */
const NOT_A_PRODUCT_LAYERS = new Set(["demo", "client"]);

/**
 * Fleet map → our own live products, each with the origin to probe.
 * A project with no live URL has nothing to sign in to yet, so it is not judged.
 */
export function ownProducts(map, org = ORG) {
  const projects = Array.isArray(map) ? map : (map?.projects ?? []);
  return projects
    .filter((p) => p && p.owner === org && p.status === "live")
    .filter((p) => !NOT_A_PRODUCT_LAYERS.has(p.layer))
    .filter((p) => p.slug !== IDENTITY_PROVIDER_APP)
    .map((p) => ({ name: p.slug, site: p.urls?.live ?? null }))
    .filter((p) => typeof p.site === "string" && /^https?:\/\//.test(p.site));
}

/** A next-auth providers payload → its provider ids, sorted. */
export function providerIds(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload)
    .filter(([, p]) => p && typeof p === "object" && typeof p.signinUrl === "string")
    .map(([id]) => id)
    .sort();
}

/** own-product-signin.baseline → Map(app → Set(provider ids tolerated)). */
export function parseBaseline(text) {
  const map = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [app, ids] = line.split(/\s+/);
    if (!app || !ids) continue;
    map.set(app, new Set(ids.split(",").map((s) => s.trim()).filter(Boolean)));
  }
  return map;
}

/**
 * The whole decision for one product, from one probe. Pure, so the self-test
 * pins every verdict from captured payloads with no network.
 */
export function judge(app, probeResult, baseline) {
  const { status, error, payload } = probeResult;
  const tolerated = baseline.get(app) ?? new Set();

  if (error || status === 0) {
    return { app, state: "skip", detail: `unreachable (${error ?? "no response"})` };
  }
  if (status === 404 || status === 410) {
    return {
      app,
      state: "skip",
      detail: "no /api/auth/providers — not next-auth, so this check cannot see its sign-in",
    };
  }
  if (status >= 500) {
    return { app, state: "skip", detail: `providers → ${status}; nextauth-origin-audit fails this` };
  }
  const ids = providerIds(payload);
  if (status !== 200 || ids.length === 0) {
    return { app, state: "skip", detail: `providers → ${status}, no provider list` };
  }

  const extra = ids.filter((id) => id !== ALLOWED_PROVIDER);
  const untolerated = extra.filter((id) => !tolerated.has(id));
  const stale = [...tolerated].filter((id) => !extra.includes(id));

  if (untolerated.length) {
    return {
      app,
      state: "fail",
      detail: `offers ${untolerated.join(", ")} — own products sign in via ${ALLOWED_PROVIDER} only`,
    };
  }
  if (stale.length) {
    return {
      app,
      state: "fail",
      detail: `baseline still tolerates ${stale.join(", ")}, which is gone — delete it from the baseline`,
    };
  }
  if (extra.length) {
    return { app, state: "held", detail: `still offers ${extra.join(", ")} (baseline)` };
  }
  return { app, state: "pass", detail: `${ALLOWED_PROVIDER} only` };
}

/** A baseline row for an app that is no longer an own live product is stale too. */
export function orphanedBaseline(baseline, products) {
  const names = new Set(products.map((p) => p.name));
  return [...baseline.keys()].filter((app) => !names.has(app));
}

const MARK = { pass: "✓", fail: "✗", held: "◐", skip: "⊘" };

export function report(rows, orphans = []) {
  const width = Math.max(4, ...rows.map((r) => r.app.length));
  const lines = ["", "  own products: sign in via OrangeCat only", ""];
  for (const r of rows) {
    lines.push(`  ${MARK[r.state]} ${r.app.padEnd(width)}  ${r.state.toUpperCase().padEnd(4)}  ${r.detail}`);
  }
  for (const app of orphans) {
    lines.push(`  ${MARK.fail} ${app.padEnd(width)}  FAIL  in the baseline but not a live own product — delete the row`);
  }
  const counts = { pass: 0, fail: orphans.length, held: 0, skip: 0 };
  for (const r of rows) counts[r.state]++;
  lines.push("");
  lines.push(
    `  ${counts.pass} pass · ${counts.held} held · ${counts.fail} fail · ${counts.skip} skip · ${rows.length} product(s)`,
  );
  if (counts.fail) {
    lines.push("");
    lines.push("  An own product offering another sign-in is a second identity for the same person.");
    lines.push("  Remove the provider, or — if a CONNECTED ACCOUNT is needed (e.g. GitHub for repo");
    lines.push("  access) — link it after an OrangeCat sign-in instead of making it a way in.");
  }
  return lines.join("\n");
}

// ── effects ─────────────────────────────────────────────────────────────────

async function readMap() {
  if (process.env.FLEET_MAP_FILE) return JSON.parse(readFileSync(process.env.FLEET_MAP_FILE, "utf8"));
  const res = await fetch(MAP_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`fleet map ${MAP_URL} → ${res.status}`);
  return res.json();
}

export async function main() {
  const products = ownProducts(await readMap());
  // An empty list is a broken read, not a clean fleet.
  if (products.length === 0) {
    console.error("✗ no own live products in the fleet map — refusing to report a clean result");
    process.exit(2);
  }
  const baseline = parseBaseline(readFileSync(BASELINE_FILE, "utf8"));
  const rows = [];
  for (const p of products) rows.push(judge(p.name, await probe(p.site), baseline));
  const orphans = orphanedBaseline(baseline, products);
  console.log(report(rows, orphans));
  const failed = orphans.length > 0 || rows.some((r) => r.state === "fail");
  process.exit(failed && !WARN_ONLY ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✗ audit failed: ${err?.message ?? err}`);
    process.exit(2);
  });
}
