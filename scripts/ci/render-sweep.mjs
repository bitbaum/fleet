#!/usr/bin/env node
/**
 * Fleet render sweep: layout defects that only exist once a page is painted,
 * checked on every live site at three widths, and RATCHETED.
 *
 * ui-defect-audit.mjs renders each site's entry page and reports (warn-only)
 * contrast, alignment and nav semantics. This sweep renders MORE pages per
 * site (home + key pages, from render-sweep.pages.json), owns the classes
 * below, and fails when any site x check count rises above
 * render-sweep.baseline. It reuses ui-defect-audit's MEASURE for the nav
 * contract rules 3, 7 and 8 rather than writing them twice.
 *
 *   rule3-small-target   nav/header control under 44x44         (MEASURE)
 *   rule7-nav-offscreen  nav/header control crossing the edge   (MEASURE)
 *   rule8-sideways       the page scrolls sideways              (MEASURE)
 *   offscreen-control    any OTHER control crossing the edge, not inside a
 *                        clipping scroller (a carousel is fine)
 *   fixed-overlap        two fixed/sticky controls on top of each other,
 *                        incl. the Loki feedback launcher — the click goes
 *                        to whichever paints last
 *   empty-heading        a heading (or a label-styled line) followed by no
 *                        content before the next heading or the section end
 *                        — substrata's orphan "EXTRACT" in the country panel
 *   split-number         a number/percent/currency token broken across two
 *                        lines inside a table cell or stat — "25,000 (" /
 *                        "±0%)"
 *   page-errors          uncaught exceptions on load (count)
 *   (console errors are COUNTED in the report but not ratcheted: blocked
 *    third-party beacons make them noise, not a regression signal)
 *
 * SAFETY. Public GET pages only: every URL is a page.goto on a path from the
 * config, and any path matching DENY (api, admin, auth, cron, jobs, account…)
 * is refused before a request is made. A page that lands on a sign-in URL is
 * reported as "auth-gated" and not measured. No clicks except the nav-menu
 * openers ui-defect-audit already uses (URL-guarded). No AI calls.
 *
 * Usage:
 *   node scripts/ci/render-sweep.mjs                    # sweep, exit 1 on a regression
 *   node scripts/ci/render-sweep.mjs --emit-baseline    # rewrite the baseline from this run
 *   node scripts/ci/render-sweep.mjs --out DIR          # report dir (default render-sweep-report)
 *   SITES=substrata,loki node scripts/ci/render-sweep.mjs   # only these sites
 *   APPS_CONF=/path/apps.conf                           # else read from bitbaum/loki via gh
 *   VIEWPORTS="390x844,1440x1000"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCLOSE,
  MEASURE,
  loadPlaywright,
  openButtonMenus,
  parseViewports,
} from "./ui-defect-audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = join(HERE, "render-sweep.baseline");
export const PAGES_PATH = join(HERE, "render-sweep.pages.json");

export const CHECKS = [
  "rule3-small-target",
  "rule7-nav-offscreen",
  "rule8-sideways",
  "offscreen-control",
  "fixed-overlap",
  "empty-heading",
  "split-number",
  "page-errors",
];

/** Paths this sweep will never request, whatever the config says. */
export const DENY =
  /^\/(?:api|admin|auth|login|logout|signin|sign-in|signup|sign-up|register|account|settings|dashboard|cron|jobs?|internal|webhooks?|_next|private)(?:[/?#]|$)/i;

/** A final URL that looks like a sign-in wall: the page is not public. */
const AUTH_WALL = /\/(?:login|signin|sign-in|auth)(?:[/?#]|$)/i;

/** apps.conf statuses that mean "something is served at this host". */
const SERVED = new Set(["live", "validating", "prospect", "demo", "unverified"]);

/**
 * apps.conf -> [{name, url, owner, kind, status}] for rows that are served.
 * The format is loki's: name|port|domains|repo_path|app_dir|db|owner|kind|status|…
 */
export function parseAppsConf(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    if (f.length < 9) continue;
    const [name, , domains, , , , owner, kind, status] = f;
    if (!SERVED.has(status)) continue;
    const host = domains.split(",")[0].trim();
    if (!host) continue;
    out.push({ name, url: `https://${host}`, owner, kind, status });
  }
  return out;
}

/** Sites = served apps.conf rows + the config's extra (handcrafted) sites. */
export function resolveSites(appsConfText, config, only) {
  const byName = new Map();
  for (const s of parseAppsConf(appsConfText)) byName.set(s.name, s);
  for (const [name, s] of Object.entries(config.extraSites ?? {})) {
    if (!byName.has(name)) byName.set(name, { name, ...s });
  }
  let sites = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (only?.length) sites = sites.filter((s) => only.includes(s.name));
  return sites.map((s) => {
    const paths = (config.pages?.[s.name] ?? ["/"]).filter((p) => !DENY.test(p));
    return { ...s, client: /^client-/.test(s.kind ?? ""), paths };
  });
}

/**
 * Checks run in the page. A STRING, like ui-defect-audit's MEASURE: a bundler
 * helper injected into an arrow function would throw inside the browser.
 */
export const RENDER_MEASURE = String.raw`(() => {
  var vw = document.documentElement.clientWidth || innerWidth;
  var INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"]';
  var visible = function (el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    return true;
  };
  var label = function (el) {
    return ((el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.tagName.toLowerCase()) + "")
      .trim().replace(/\s+/g, " ").slice(0, 40);
  };
  var positionedAncestor = function (el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") return n;
    }
    return null;
  };

  // ── offscreen-control: any control part-on, part-off screen ───────────────
  // nav/header controls are rule 7 (MEASURE) and skipped here. A control
  // inside a scroller that clips on x (a carousel, a code block) is reachable
  // by scrolling that scroller, so it is not a defect.
  var offscreen = [];
  var all = document.querySelectorAll(INTERACTIVE);
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.closest('nav, [role="navigation"], header')) continue;
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    var off = 0, side = "";
    if (r.left < -4 && r.right > 4) { off = Math.round(-r.left); side = "left"; }
    else if (r.right > vw + 4 && r.left < vw - 4) { off = Math.round(r.right - vw); side = "right"; }
    if (!off) continue;
    var clipped = false;
    for (var a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      var ox = getComputedStyle(a).overflowX;
      if (ox !== "visible") { clipped = true; break; }
    }
    if (clipped) continue;
    offscreen.push({ text: label(el), tag: el.tagName.toLowerCase(), side: side, off: off });
  }

  // ── fixed-overlap: fixed/sticky controls stacked on each other ───────────
  var fixed = [];
  for (var j = 0; j < all.length; j++) {
    var fe = all[j];
    if (!visible(fe)) continue;
    if (!positionedAncestor(fe)) continue;
    fixed.push({ el: fe, r: fe.getBoundingClientRect(), text: label(fe) });
  }
  // The Loki launcher lives in a shadow root the selector above cannot see.
  var lokiHost = document.getElementById("loki-feedback-host");
  var lokiFab = lokiHost && lokiHost.shadowRoot && lokiHost.shadowRoot.querySelector(".fab");
  if (lokiFab && getComputedStyle(lokiFab).visibility !== "hidden" && lokiFab.getBoundingClientRect().width > 1) {
    fixed.push({ el: lokiHost, r: lokiFab.getBoundingClientRect(), text: "Loki feedback launcher", loki: true });
  }
  var overlaps = [];
  for (var p = 0; p < fixed.length; p++) {
    for (var q = p + 1; q < fixed.length; q++) {
      var A = fixed[p], B = fixed[q];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      var ix = Math.max(A.r.left, B.r.left), ax = Math.min(A.r.right, B.r.right);
      var iy = Math.max(A.r.top, B.r.top), ay = Math.min(A.r.bottom, B.r.bottom);
      if (ax - ix <= 4 || ay - iy <= 4) continue;
      var cx = (ix + ax) / 2, cy = (iy + ay) / 2;
      if (cx < 0 || cy < 0 || cx >= vw || cy >= innerHeight) continue;
      // Both must be HIT at that point, not merely have boxes there: a nav
      // item scrolled out of its sidebar's clip still reports a rect under
      // the sidebar's footer button, but nothing can click it — so it is not
      // covered, it is scrolled away. elementsFromPoint skips clipped boxes.
      var stack = document.elementsFromPoint(cx, cy);
      var ia = -1, ib = -1;
      for (var si = 0; si < stack.length; si++) {
        if (ia < 0 && (stack[si] === A.el || A.el.contains(stack[si]))) ia = si;
        if (ib < 0 && (stack[si] === B.el || B.el.contains(stack[si]))) ib = si;
      }
      if (ia < 0 || ib < 0) continue;
      var top = ia < ib ? A : B, under = ia < ib ? B : A;
      overlaps.push({ top: top.text, under: under.text, loki: !!(A.loki || B.loki) });
    }
  }

  // ── empty-heading ─────────────────────────────────────────────────────────
  var SECTION_END = "section, article, aside, main, details, dialog, form, body, [role='region']";
  var LIST_CELL = "li, td, th, dd";
  var HEADING = "h1, h2, h3, h4, h5, h6, [role='heading']";
  var CONTENT_TAGS = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, BUTTON: 1, TABLE: 1, PICTURE: 1, OBJECT: 1, AUDIO: 1 };
  var levelOf = function (h) {
    var m = /^H([1-6])$/.exec(h.tagName);
    if (m) return Number(m[1]);
    return Number(h.getAttribute("aria-level")) || 2;
  };
  var hidden = function (el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    if (el.hasAttribute("popover") && !el.matches(":popover-open")) return true;
    var r = el.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1 && cs.position === "absolute";
  };
  // What comes first after "from" in document order: content, a heading, or
  // the end of its section. Returns {kind, el?}.
  var nextThing = function (from) {
    var n = from;
    var steps = 0;
    for (;;) {
      // advance past n's subtree
      while (n && !n.nextSibling) {
        n = n.parentNode;
        if (!n || n.nodeType !== 1) return { kind: "end" };
        if (n.matches(LIST_CELL)) return { kind: "cell" };
        if (n.matches(SECTION_END)) return { kind: "end" };
      }
      if (!n) return { kind: "end" };
      n = n.nextSibling;
      // descend into n until something decides
      for (;;) {
        if (++steps > 4000) return { kind: "content" };
        if (n.nodeType === 3) {
          if ((n.nodeValue || "").trim()) return { kind: "content" };
          break;
        }
        if (n.nodeType !== 1) break;
        if (hidden(n)) break;
        if (n.matches(HEADING)) return { kind: "heading", el: n };
        if (CONTENT_TAGS[n.tagName.toUpperCase()]) return { kind: "content" };
        if (!n.firstChild) break;
        n = n.firstChild;
      }
    }
  };
  var sectionOf = function (el) { return el.parentElement ? el.parentElement.closest(SECTION_END) : null; };
  var empties = [];
  var judged = 0;
  var consider = function (el, isKicker) {
    if (el.closest("a[href], button, summary, label, nav, footer, [role='navigation'], th, thead, dt, legend")) return;
    if (!visible(el)) return;
    var t = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (!t) return;
    judged++;
    var nx = nextThing(el);
    var empty = false;
    // A label-styled line LAST in its section is a caption (a job title under
    // a name), not a label for missing content; only a real heading is
    // judged at the section end.
    if (nx.kind === "end") empty = !isKicker;
    else if (nx.kind === "heading") {
      if (isKicker) {
        // An eyebrow above its own heading is design; a label whose next
        // heading opens a DIFFERENT section labels nothing.
        var hs = sectionOf(nx.el);
        empty = !!hs && !hs.contains(el);
      } else {
        empty = levelOf(nx.el) <= levelOf(el);
      }
    }
    if (empty) {
      empties.push({ text: t.slice(0, 40), tag: el.tagName.toLowerCase(), kicker: isKicker, next: nx.kind === "heading" ? (nx.el.innerText || "").trim().slice(0, 40) : "(section end)" });
    }
  };
  var heads = document.querySelectorAll(HEADING);
  for (var h = 0; h < heads.length; h++) consider(heads[h], false);
  // Label-styled lines: short, uppercase, a block of their own, no controls.
  var blocks = document.querySelectorAll("p, div, span, strong, small");
  for (var b = 0; b < blocks.length; b++) {
    var k = blocks[b];
    if (k.matches(HEADING)) continue;
    var kcs = getComputedStyle(k);
    if (kcs.textTransform !== "uppercase") continue;
    if (!/^(block|flex|list-item|grid)$/.test(kcs.display)) continue;
    // A chip or badge (its own fill or border) is a tag, not a label for
    // what follows: vitareba's program cards end in "90-TAGE-PROGRAMM".
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(kcs.backgroundColor) || parseFloat(kcs.borderTopWidth) > 0 || parseFloat(kcs.borderLeftWidth) > 0) continue;
    if (k.querySelector("a, button, input, img, svg, " + HEADING)) continue;
    if (k.children.length > 3) continue;
    var kt = (k.innerText || "").trim();
    if (kt.length < 2 || kt.length > 40) continue;
    // Only the innermost label-styled block, so a styled wrapper and its
    // styled child are one finding.
    if (k.parentElement && getComputedStyle(k.parentElement).textTransform === "uppercase" &&
        (k.parentElement.innerText || "").trim() === kt) continue;
    consider(k, true);
  }

  // ── split-number: a figure broken across lines in a cell or stat ─────────
  var splits = [];
  var STAT = "td, th, dd, [class*='stat'], [class*='metric'], [class*='kpi'], [class*='figure']";
  var TOKEN = /[^\s]*\d[^\s]*/g;
  var hosts = document.querySelectorAll(STAT);
  var seenText = [];
  for (var s = 0; s < hosts.length; s++) {
    var hostEl = hosts[s];
    if (!visible(hostEl)) continue;
    var walker = document.createTreeWalker(hostEl, NodeFilter.SHOW_TEXT);
    for (var tn = walker.nextNode(); tn; tn = walker.nextNode()) {
      if (seenText.indexOf(tn) !== -1) continue;
      seenText.push(tn);
      var val = tn.nodeValue || "";
      TOKEN.lastIndex = 0;
      var m2;
      while ((m2 = TOKEN.exec(val))) {
        if (m2[0].length < 2) continue;
        var rg = document.createRange();
        rg.setStart(tn, m2.index);
        rg.setEnd(tn, m2.index + m2[0].length);
        var rects = Array.prototype.filter.call(rg.getClientRects(), function (x) { return x.width > 0; });
        if (rects.length < 2) continue;
        var tops = [];
        for (var z = 0; z < rects.length; z++) {
          var tp = rects[z].top, fresh = true;
          for (var y = 0; y < tops.length; y++) if (Math.abs(tops[y] - tp) < rects[z].height / 2) fresh = false;
          if (fresh) tops.push(tp);
        }
        if (tops.length > 1) {
          splits.push({ token: m2[0].slice(0, 30), cell: (hostEl.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50) });
        }
      }
    }
  }
  // A split can also fall at a text-node boundary inside one token, e.g.
  // "25,000 (" + "<span>±0%</span>" + ")". Same test on each cell's joined text
  // is not possible with ranges, so the cell-level line count catches the
  // common case: a cell whose ONLY content is a figure should be one line.
  for (var s2 = 0; s2 < hosts.length; s2++) {
    var he = hosts[s2];
    if (!visible(he) || he.querySelector("td, th, dd, p, div, br, li")) continue;
    var txt = (he.innerText || "").trim().replace(/\s+/g, " ");
    if (!/^[-+±(]?[$€£¥]?\s?[\d.,'’  ]+\s?(?:%|[kKmMbB]n?)?(?:\s?\(?[-+±]?[\d.,]*%?\)?)?[a-z]?$/.test(txt)) continue;
    var rr = document.createRange();
    rr.selectNodeContents(he);
    var lines = [];
    Array.prototype.forEach.call(rr.getClientRects(), function (x) {
      if (x.width <= 0) return;
      for (var w = 0; w < lines.length; w++) if (Math.abs(lines[w] - x.top) < x.height / 2) return;
      lines.push(x.top);
    });
    if (lines.length > 1) {
      var dup = splits.some(function (f) { return f.cell === txt.slice(0, 50); });
      if (!dup) splits.push({ token: txt.slice(0, 30), cell: txt.slice(0, 50) });
    }
  }

  return {
    offscreenControl: offscreen,
    fixedOverlap: overlaps,
    emptyHeading: empties,
    headingsJudged: judged,
    splitNumber: splits
  };
})()`;

/** A finding's identity — the same decision seen at three widths is ONE. */
export function keyOf(check, path, f) {
  switch (check) {
    case "rule3-small-target": return `${path}|${f.tag}|${f.text}`;
    case "rule7-nav-offscreen": return `${path}|${f.side}|${f.tag}|${f.text}|${f.href}`;
    case "rule8-sideways": return `${path}`;
    case "offscreen-control": return `${path}|${f.side}|${f.tag}|${f.text}`;
    case "fixed-overlap": return `${path}|${[f.top, f.under].sort().join("~")}`;
    case "empty-heading": return `${path}|${f.tag}|${f.text}`;
    case "split-number": return `${path}|${f.token}|${f.cell}`;
    case "page-errors": return `${path}|${f.message}`;
    default: return `${path}|${JSON.stringify(f)}`;
  }
}

/** One page render (MEASURE + RENDER_MEASURE + errors) -> [{check, f}]. */
export function findingsOf(measure, render, pageErrors) {
  const out = [];
  for (const f of measure.navSmallTargets ?? []) out.push({ check: "rule3-small-target", f });
  for (const f of measure.navOffViewport ?? []) out.push({ check: "rule7-nav-offscreen", f });
  if (measure.pageOverflow > 0) out.push({ check: "rule8-sideways", f: { px: measure.pageOverflow } });
  for (const f of render.offscreenControl ?? []) out.push({ check: "offscreen-control", f });
  for (const f of render.fixedOverlap ?? []) out.push({ check: "fixed-overlap", f });
  for (const f of render.emptyHeading ?? []) out.push({ check: "empty-heading", f });
  for (const f of render.splitNumber ?? []) out.push({ check: "split-number", f });
  for (const message of pageErrors ?? []) out.push({ check: "page-errors", f: { message: String(message).slice(0, 120) } });
  return out;
}

/** Merge per-page/width findings into distinct findings per site. */
export function mergeFindings(records) {
  const bySite = new Map();
  for (const { site, path, width, findings } of records) {
    if (!bySite.has(site)) bySite.set(site, new Map());
    const m = bySite.get(site);
    for (const { check, f } of findings) {
      const k = `${check}|${keyOf(check, path, f)}`;
      const seen = m.get(k);
      if (seen) { if (!seen.widths.includes(width)) seen.widths.push(width); }
      else m.set(k, { check, path, f, widths: [width] });
    }
  }
  return bySite;
}

/** site -> check -> count of distinct findings. */
export function tally(merged) {
  const out = {};
  for (const [site, m] of merged) {
    out[site] = Object.fromEntries(CHECKS.map((c) => [c, 0]));
    for (const x of m.values()) out[site][x.check] += 1;
  }
  return out;
}

export function readBaseline(text) {
  const base = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [site, check, n] = line.split(/\s+/);
    if (!site || !check || !Number.isFinite(Number(n))) continue;
    (base[site] ??= {})[check] = Number(n);
  }
  return base;
}

export function formatBaseline(counts) {
  const lines = [
    "# render-sweep findings per site x check. A RATCHET: a count may fall, never rise.",
    "# Regenerate deliberately with --emit-baseline, in the PR that lowers it; a PR",
    "# that RAISES a line is a human deciding to accept a defect, and says why.",
  ];
  for (const site of Object.keys(counts).sort()) {
    for (const check of CHECKS) {
      const n = counts[site][check] ?? 0;
      if (n > 0) lines.push(`${site} ${check} ${n}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Rises against the baseline. Only sites that were actually MEASURED are
 * judged (a site that failed to render is reported separately, never read as
 * clean), and a site x check absent from the baseline counts as 0.
 */
export function regressions(counts, base) {
  const out = [];
  for (const [site, byCheck] of Object.entries(counts)) {
    for (const check of CHECKS) {
      const now = byCheck[check] ?? 0;
      const was = base[site]?.[check] ?? 0;
      if (now > was) out.push({ site, check, now, was });
    }
  }
  return out;
}

export function improvements(counts, base) {
  const out = [];
  for (const [site, byCheck] of Object.entries(base)) {
    if (!counts[site]) continue;
    for (const [check, was] of Object.entries(byCheck)) {
      const now = counts[site][check] ?? 0;
      if (now < was) out.push({ site, check, now, was });
    }
  }
  return out;
}

const SHORT = {
  "rule3-small-target": "r3 <44px",
  "rule7-nav-offscreen": "r7 nav off",
  "rule8-sideways": "r8 sideways",
  "offscreen-control": "ctrl off",
  "fixed-overlap": "fixed overlap",
  "empty-heading": "empty heading",
  "split-number": "split number",
  "page-errors": "page errors",
};

export function toMarkdown({ sites, counts, merged, consoleErrors, unmeasured, regress, better, widths }) {
  const L = [];
  L.push(`# Render sweep`, ``);
  L.push(`${sites.length} site(s) x ${widths.join("/")}px. Counts are DISTINCT findings (one decision seen at three widths is one).`, ``);
  L.push(`| site | ${CHECKS.map((c) => SHORT[c]).join(" | ")} | console errors |`);
  L.push(`|---|${CHECKS.map(() => "---:").join("|")}|---:|`);
  for (const s of sites) {
    const c = counts[s.name];
    const tag = s.client ? " (client)" : "";
    if (!c) { L.push(`| ${s.name}${tag} | ${CHECKS.map(() => "–").join(" | ")} | – |`); continue; }
    L.push(`| ${s.name}${tag} | ${CHECKS.map((k) => c[k] || "·").join(" | ")} | ${consoleErrors[s.name] ?? 0} |`);
  }
  L.push("");
  if (regress.length) {
    L.push(`## Regressions (fail)`, "");
    for (const r of regress) L.push(`- **${r.site}** ${r.check}: ${r.was} → ${r.now}`);
    L.push("");
  }
  if (better.length) {
    L.push(`## Below baseline — lower it with --emit-baseline`, "");
    for (const r of better) L.push(`- ${r.site} ${r.check}: ${r.was} → ${r.now}`);
    L.push("");
  }
  if (unmeasured.length) {
    L.push(`## Not measured (NOT clean)`, "");
    for (const u of unmeasured) L.push(`- ${u.site} ${u.path} @${u.width}: ${u.why}`);
    L.push("");
  }
  L.push(`## Findings`, "");
  for (const s of sites) {
    const m = merged.get(s.name);
    if (!m || !m.size) continue;
    L.push(`### ${s.name} — ${s.url}`, "");
    for (const x of [...m.values()].sort((a, b) => (a.check + a.path).localeCompare(b.check + b.path))) {
      L.push(`- \`${x.check}\` ${x.path} [${x.widths.join("/")}] ${describe(x.check, x.f)}`);
    }
    L.push("");
  }
  return L.join("\n");
}

function describe(check, f) {
  switch (check) {
    case "rule3-small-target": return `${f.w}x${f.h} <${f.tag}> "${f.text}"`;
    case "rule7-nav-offscreen":
    case "offscreen-control": return `<${f.tag}> "${f.text}" crosses the ${f.side} edge by ${f.off}px`;
    case "rule8-sideways": return `scrolls sideways by ${f.px}px`;
    case "fixed-overlap": return `"${f.top}" sits on "${f.under}"${f.loki ? " (Loki launcher)" : ""}`;
    case "empty-heading": return `<${f.tag}>${f.kicker ? " label" : ""} "${f.text}" → next: ${f.next}`;
    case "split-number": return `"${f.token}" wraps inside "${f.cell}"`;
    case "page-errors": return f.message;
    default: return JSON.stringify(f);
  }
}

function readAppsConf() {
  if (process.env.APPS_CONF) return readFileSync(process.env.APPS_CONF, "utf8");
  try {
    const blob = JSON.parse(
      execFileSync("gh", ["api", "repos/bitbaum/loki/contents/scripts/hetzner/apps.conf"], { encoding: "utf8" }),
    );
    return Buffer.from(blob.content, "base64").toString("utf8");
  } catch (e) {
    console.error(`✗ could not read loki's apps.conf (set APPS_CONF or authenticate gh): ${e.message}`);
    process.exit(2);
  }
}

/** Render one page at one width. Returns {findings, consoleErrors} or {why}. */
export async function renderPage(ctx, url) {
  // newPage is OUTSIDE the try below on purpose: if it throws, the context or
  // the browser is gone, and the caller must rebuild it rather than record
  // the page as merely unmeasured.
  const page = await ctx.newPage();
  const pageErrors = [];
  let consoleErrors = 0;
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors += 1; });
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (res && res.status() >= 400) return { why: `HTTP ${res.status()}` };
    if (AUTH_WALL.test(new URL(page.url()).pathname)) return { why: `auth-gated (landed on ${new URL(page.url()).pathname})` };
    // Past the Loki widget's 2.5s re-check and most hydration.
    await page.waitForTimeout(4000);
    const render = await page.evaluate(RENDER_MEASURE);
    await page.evaluate(DISCLOSE);
    await openButtonMenus(page);
    await page.waitForTimeout(250);
    const measure = await page.evaluate(MEASURE);
    return { findings: findingsOf(measure, render, pageErrors), consoleErrors };
  } catch (e) {
    return { why: e.message.split("\n")[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * renderPage, surviving a dead browser. One crashed renderer (seen 2026-09-26
 * under load: "Target page, context or browser has been closed") used to throw
 * out of main() and lose the whole sweep - every site already measured, no
 * report. Now the browser and context are rebuilt and the page is tried once
 * more; a second failure is recorded as unmeasured, never as clean.
 */
export async function renderWithRecovery(env, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await renderPage(env.ctx, url);
    } catch (e) {
      const why = e.message.split("\n")[0];
      if (attempt === 1) return { why: `browser lost twice: ${why}` };
      console.log(`  ~ rebuilding the browser after: ${why}`);
      await env.rebuild();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const emit = args.includes("--emit-baseline");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : "render-sweep-report";
  const only = process.env.SITES?.split(",").map((s) => s.trim()).filter(Boolean);
  const config = JSON.parse(readFileSync(PAGES_PATH, "utf8"));
  const sites = resolveSites(readAppsConf(), config, only);
  const viewports = parseViewports();
  const { chromium } = loadPlaywright();
  console.log(`render sweep — ${sites.length} site(s) x ${viewports.map((v) => v.label).join("/")}px\n`);

  let browser = await chromium.launch();
  const records = [];
  const unmeasured = [];
  const consoleErrors = {};
  const measuredSites = new Set();
  for (const vp of viewports) {
    const newCtx = () => browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.width < 600,
      hasTouch: vp.width < 600,
      userAgent: undefined,
    });
    const env = { ctx: await newCtx() };
    env.rebuild = async () => {
      await env.ctx.close().catch(() => {});
      if (!browser.isConnected()) browser = await chromium.launch();
      env.ctx = await newCtx();
    };
    for (const s of sites) {
      for (const path of s.paths) {
        const url = new URL(path, s.url).toString();
        const r = await renderWithRecovery(env, url);
        if (r.why) {
          unmeasured.push({ site: s.name, path, width: vp.label, why: r.why });
          console.log(`  ! ${s.name} ${path} @${vp.label}: ${r.why}`);
          continue;
        }
        measuredSites.add(s.name);
        consoleErrors[s.name] = (consoleErrors[s.name] ?? 0) + r.consoleErrors;
        records.push({ site: s.name, path, width: vp.label, findings: r.findings });
        console.log(`  ${s.name} ${path} @${vp.label}: ${r.findings.length} finding(s)`);
      }
    }
    await env.ctx.close().catch(() => {});
  }
  await browser.close();

  const merged = mergeFindings(records);
  for (const name of measuredSites) if (!merged.has(name)) merged.set(name, new Map());
  const counts = tally(merged);
  const base = existsSync(BASELINE_PATH) ? readBaseline(readFileSync(BASELINE_PATH, "utf8")) : {};
  const regress = regressions(counts, base);
  const better = improvements(counts, base);

  mkdirSync(outDir, { recursive: true });
  const json = {
    generatedAt: new Date().toISOString(),
    widths: viewports.map((v) => v.label),
    sites: sites.map(({ name, url, kind, client, paths }) => ({ name, url, kind, client, paths })),
    counts, consoleErrors, unmeasured, regressions: regress, improvements: better,
    findings: Object.fromEntries([...merged].map(([k, m]) => [k, [...m.values()]])),
  };
  writeFileSync(join(outDir, "render-sweep.json"), JSON.stringify(json, null, 2));
  const md = toMarkdown({ sites, counts, merged, consoleErrors, unmeasured, regress, better, widths: json.widths });
  writeFileSync(join(outDir, "render-sweep.md"), md);
  console.log(`\n${md.split("\n## Findings")[0]}`);
  console.log(`report: ${join(outDir, "render-sweep.md")} + render-sweep.json`);

  if (emit) {
    // Keep baseline lines of sites this run could not measure: a site that
    // was down is not a site that got clean.
    const keep = { ...counts };
    for (const [site, byCheck] of Object.entries(base)) if (!keep[site]) keep[site] = byCheck;
    writeFileSync(BASELINE_PATH, formatBaseline(keep));
    console.log(`baseline written: ${BASELINE_PATH}`);
    process.exit(0);
  }
  if (regress.length) {
    console.log(`\n✗ ${regress.length} site x check count(s) rose above the baseline:`);
    for (const r of regress) console.log(`    ${r.site} ${r.check}: ${r.was} → ${r.now}`);
    process.exit(1);
  }
  console.log(`\n✓ no site x check rose above its baseline${better.length ? ` (${better.length} fell — lower the baseline)` : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
