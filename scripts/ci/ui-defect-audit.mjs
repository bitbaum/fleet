#!/usr/bin/env node
/**
 * Fleet audit: two rendered defects that no unit test, type check or lint rule
 * can see, because nothing is wrong until the page is painted.
 *
 *   1. INVISIBLE ACTIONS — an interactive label below its WCAG AA contrast
 *      floor. On fleetcrown/control the only route to a feedback report's
 *      screenshot and history rendered at 3.13:1; the operator's report was not
 *      "low contrast", it was "i dont see it". An action nobody can find is a
 *      feature that does not exist.
 *
 *   2. RAGGED STACKS — sibling lines in one vertical stack that start at
 *      slightly different x, and wrapped lines whose second line does not align
 *      with the first. Both come from the same habit: putting an icon INLINE at
 *      the head of a line, so it shoves that one line sideways by its own width
 *      and gives a wrapped paragraph no hanging indent. On fleetcrown's fleet
 *      card four stacked rows started at three different x (369 / 383 / 385)
 *      with the hint's second line snapping back to 369. The operator's words
 *      were "this area looks bad. not aligned."
 *
 * Central auditor, same doctrine as verify-floor-audit.sh: ONE script that
 * reads every SITE remotely, never a check copied into each repo. A copied
 * check drifts; this one cannot.
 *
 * The site list is DISCOVERED, not hardcoded: fleetcrown's public footer is the
 * fleet's own SSOT for "sites we run" (config/fleet-sites.ts renders there
 * precisely so each has a crawlable anchor). Reading it live means a new site
 * is audited the day it is linked, and a retired one stops being audited,
 * without anyone editing this file.
 *
 * SCOPE — what this does NOT prove. It renders each site's PUBLIC entry page
 * only, unauthenticated. Defects behind a login are invisible here; for those,
 * run the per-repo authed audits (fleetcrown: `npm run audit:contrast`). It
 * also judges only text it can attribute to a background — an element painted
 * over an image reports the image's absence, not its colour, so those are
 * skipped rather than guessed at.
 *
 * Usage:
 *   node scripts/ci/ui-defect-audit.mjs                 # audit, exit 1 on defects
 *   node scripts/ci/ui-defect-audit.mjs --warn-only     # report, always exit 0
 *   SITES="https://a.example,https://b.example" node scripts/ci/ui-defect-audit.mjs
 *
 * Needs playwright. dotfiles has no package.json on purpose, so the browser is
 * resolved from a fleet repo that already installs it (override with
 * PLAYWRIGHT_FROM=/path/to/repo).
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WARN_ONLY = process.argv.includes("--warn-only");
const AA_SMALL = 4.5;
const AA_LARGE = 3.0;
/** A stack whose rows differ by more than this is deliberate indentation, not
 *  an icon accidentally shoving one line sideways. Icons in this fleet are
 *  10–16px plus a gap; 24 covers them with headroom and excludes real nesting. */
const MAX_ACCIDENTAL_INDENT_PX = 24;
const DISCOVERY_URL = process.env.DISCOVERY_URL ?? "https://fleetcrown.orangecat.ch/";

export function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_FROM,
    join(homedir(), "dev", "fleetcrown"),
    join(homedir(), "dev", "orangecat"),
    join(homedir(), "dev", "vitareba"),
  ].filter(Boolean);
  for (const root of candidates) {
    const entry = join(root, "node_modules", "playwright", "index.js");
    if (!existsSync(entry)) continue;
    return createRequire(join(root, "package.json"))("playwright");
  }
  console.error(
    "✗ playwright not found. Set PLAYWRIGHT_FROM=/path/to/a/repo that installs it."
  );
  process.exit(2);
}

/** The fleet's own list of the sites it runs, read from where it is published. */
async function discoverSites() {
  const explicit = process.env.SITES?.trim();
  if (explicit) return explicit.split(",").map((s) => s.trim()).filter(Boolean);

  const res = await fetch(DISCOVERY_URL, { headers: { "user-agent": "fleet-ui-audit" } });
  if (!res.ok) throw new Error(`site discovery failed: ${DISCOVERY_URL} → ${res.status}`);
  const html = await res.text();
  const found = new Set();
  for (const m of html.matchAll(/https:\/\/[a-z0-9.-]*orangecat\.ch(?=["'/\s<])/g)) {
    found.add(m[0]);
  }
  // The audit runs FROM fleetcrown's own page; auditing the page we discovered
  // from is still worth doing, so it stays in the list.
  found.add("https://fleetcrown.orangecat.ch");
  return [...found].sort();
}

/**
 * Passed to the page as a STRING, not a function: a bundler that injects a
 * `__name` helper into arrow functions makes page.evaluate throw
 * "ReferenceError: __name is not defined" inside the browser.
 */
export const MEASURE = String.raw`(() => {
  // ── colour ────────────────────────────────────────────────────────────────
  // Resolve ANY CSS colour syntax (oklch, lab, color-mix, var) to straight
  // RGBA. One paint is not enough: a translucent colour composites against
  // whatever the canvas already holds, silently discarding alpha and turning a
  // 4%-white overlay into SOLID WHITE. Paint twice over known backdrops and
  // solve:  white - black = 255*(1-a).
  var resolve = function (color) {
    var c = document.createElement("canvas"); c.width = c.height = 1;
    var x = c.getContext("2d", { willReadFrequently: true });
    var paint = function (bd) {
      x.globalCompositeOperation = "copy"; x.fillStyle = bd; x.fillRect(0, 0, 1, 1);
      x.globalCompositeOperation = "source-over"; x.fillStyle = color; x.fillRect(0, 0, 1, 1);
      return Array.prototype.slice.call(x.getImageData(0, 0, 1, 1).data, 0, 3);
    };
    var b = paint("#000"), w = paint("#fff");
    var a = 1 - (w[0] - b[0]) / 255;
    if (a <= 0.0001) return [0, 0, 0, 0];
    return [b[0] / a, b[1] / a, b[2] / a, a];
  };
  var over = function (t, bo) {
    var a = t[3];
    return [t[0]*a + bo[0]*(1-a), t[1]*a + bo[1]*(1-a), t[2]*a + bo[2]*(1-a), 1];
  };
  var lum = function (r) {
    var f = function (v) { var s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
    return 0.2126*f(r[0]) + 0.7152*f(r[1]) + 0.0722*f(r[2]);
  };
  // Composite every translucent layer down to the first opaque ancestor —
  // that stack is what the eye actually sees behind the glyphs. Returns null
  // when an image is in the way: an unknown backdrop must be skipped, not
  // guessed at, or the audit invents failures.
  var bgOf = function (el) {
    var st = [], n = el;
    while (n) {
      var cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      var c = resolve(cs.backgroundColor);
      if (c[3] > 0) st.push(c);
      if (c[3] >= 0.999) break;
      n = n.parentElement;
    }
    if (!st.length) return [0, 0, 0];
    var base = st[st.length - 1];
    if (base[3] < 1) base = over(base, [0, 0, 0, 1]);
    for (var i = st.length - 2; i >= 0; i--) base = over(st[i], base);
    return [base[0], base[1], base[2]];
  };
  var ratio = function (fgRgba, bg) {
    var fg = fgRgba[3] < 1 ? over(fgRgba, bg.concat([1])) : fgRgba;
    var a = lum(fg), b = lum(bg);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };

  var contrast = [];
  var actions = document.querySelectorAll('a, button, summary, [role="button"], [role="link"], [role="tab"]');
  for (var i = 0; i < actions.length; i++) {
    var el = actions[i];
    var text = (el.innerText || "").trim();
    if (!text) continue;
    // A wrapper whose visible label is painted by a nested action measures the
    // wrapper's own never-painted ink: surf-your-life's bare <a> around a
    // styled <button> read 1:1 against the button's fill. The nested control
    // is in the scan in its own right, so the wrapper adds nothing but noise.
    if (el.querySelector('a, button, [role="button"]')) continue;
    // WCAG exempts inactive controls: a disabled Send button is dim BECAUSE it
    // is disabled, and reporting it buries the real findings.
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.closest("[disabled],[aria-disabled='true']")) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    var bg = bgOf(el);
    if (!bg) continue;
    var size = parseFloat(cs.fontSize);
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var large = size >= 24 || (size >= 18.66 && weight >= 700);
    contrast.push({
      text: text.slice(0, 50).replace(/\s+/g, " "),
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute("href") || "",
      fontSize: Math.round(size),
      floor: large ? ${AA_LARGE} : ${AA_SMALL},
      value: ratio(resolve(cs.color), bg)
    });
  }

  // ── alignment ─────────────────────────────────────────────────────────────
  // Where the GLYPHS start, not where the box starts: an element given
  // padding-left to align it has the same rect.left as one without, so box
  // geometry cannot answer this question. A Range over the first text node
  // also yields one rect PER RENDERED LINE, which is how a missing hanging
  // indent becomes visible.
  // Decorative subtrees are skipped: an aria-hidden marker is explicitly NOT
  // content, so it must not define where the content starts. Without this the
  // audit measures the bullet instead of the label, every row reads the same x,
  // and the very misalignment the bullet CAUSES becomes invisible.
  var lineRects = function (el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && (n.nodeValue || "").trim()) {
        var rg = document.createRange();
        rg.selectNodeContents(n);
        var rects = Array.prototype.slice.call(rg.getClientRects());
        if (rects.length) { rects.host = el; return rects; }
      }
      if (n.nodeType === 1) {
        if (n.getAttribute && n.getAttribute("aria-hidden") === "true") continue;
        var inner = lineRects(n);
        if (inner) return inner;
      }
    }
    return null;
  };

  var MAXI = ${MAX_ACCIDENTAL_INDENT_PX};
  var ragged = [];
  var wrapped = [];
  var seen = 0;
  var all = document.querySelectorAll("div, section, article, header, footer, aside, main");
  for (var c = 0; c < all.length; c++) {
    var box = all[c];
    var style = getComputedStyle(box);
    var stacked = style.display === "block" ||
      ((style.display === "flex" || style.display === "inline-flex") && style.flexDirection === "column");
    if (!stacked) continue;
    var kids = [];
    for (var k = 0; k < box.children.length; k++) {
      var kid = box.children[k];
      // Lists carry markers, and absolutely-positioned children are not in the
      // stack — neither is evidence of a ragged column.
      if (kid.tagName === "LI" || kid.tagName === "UL" || kid.tagName === "OL") continue;
      if (getComputedStyle(kid).position === "absolute") continue;
      var rects = lineRects(kid);
      if (!rects) continue;
      // A child that stacks its own content VERTICALLY is a nested group — a
      // list, a sub-card — and a group is entitled to its own indent. Only peer
      // LINES have to share a column. Without this, an ordinary icon checklist
      // between a description and a CTA reads as a ragged stack, which is how
      // the first sweep "found" defects in correct markup.
      //
      // Vertically, not merely "has several children": a row of chips is two
      // spans side by side on ONE line, and that is a peer line, not a group.
      // Counting children alone exempted it and blinded the audit to the very
      // stack it was written for.
      // With TOLERANCE, not exact tops: two buttons on one row measure ~1px
      // apart when only one of them has a border, and exact comparison read
      // that row as a two-line group — exempting the very misalignment under
      // test. Real stacked lines sit at least a line-height (>8px) apart.
      var innerTops = [];
      for (var q = 0; q < kid.children.length; q++) {
        var kr = lineRects(kid.children[q]);
        if (!kr) continue;
        var top = kr[0].top;
        var newTop = true;
        for (var w = 0; w < innerTops.length; w++) {
          if (Math.abs(innerTops[w] - top) < 8) { newTop = false; break; }
        }
        if (newTop) innerTops.push(top);
      }
      if (innerTops.length >= 2) continue;
      // Where the row's PAINT starts. For plain text that is the first glyph;
      // for a row led by an element that draws its own box — a button, a chip —
      // it is that box's border edge, and the glyphs sit padding deeper by
      // design. aoz's hero read as ragged because its CTA labels start 16px
      // after the button edge that is actually flush with the column.
      var edge = rects[0].left;
      for (var h = rects.host; h && h !== box; h = h.parentElement) {
        var hcs2 = getComputedStyle(h);
        if (resolve(hcs2.backgroundColor)[3] > 0 || parseFloat(hcs2.borderLeftWidth) > 0) {
          edge = h.getBoundingClientRect().left;
        }
      }
      kids.push({ el: kid, left: Math.round(edge), text: (kid.innerText || "").trim().slice(0, 40) });
    }
    if (kids.length < 3) continue;
    seen++;
    var lefts = kids.map(function (x) { return x.left; });
    var min = Math.min.apply(null, lefts), max = Math.max.apply(null, lefts);
    var spread = max - min;
    // Below ~4px is glyph metrics, not layout: a row starting with "1" measures
    // a couple of pixels narrower than one starting with "2".
    if (spread < 4 || spread > MAXI) continue;

    // The signature of an ACCIDENTAL indent is a RETURN: the column goes out to
    // one x and comes back to a previous one (369 → 383 → 369). A heading
    // followed by consistently indented items only ever goes out and stays
    // (197 → 210 → 210 → 210) — that is structure, and flagging it would bury
    // the real defect under every correctly-built list in the fleet.
    var returns = false;
    for (var a1 = 0; a1 < lefts.length && !returns; a1++) {
      for (var b1 = a1 + 1; b1 < lefts.length && !returns; b1++) {
        if (lefts[b1] === lefts[a1]) continue;
        for (var c1 = b1 + 1; c1 < lefts.length; c1++) {
          if (lefts[c1] === lefts[a1]) { returns = true; break; }
        }
      }
    }
    if (!returns) continue;

    var distinct = lefts.filter(function (v, i2, arr) { return arr.indexOf(v) === i2; });
    ragged.push({
      rows: kids.length,
      spread: spread,
      edges: distinct.sort(function (a, b) { return a - b; }),
      sample: kids.slice(0, 5).map(function (x) { return x.left + ":" + x.text.replace(/\n/g, " "); })
    });
  }

  // Wrapped lines that do not share a left edge: line 1 starts after an inline
  // icon, line 2 falls back to the container edge.
  var textish = document.querySelectorAll("p, span, div, li, dd, figcaption");
  for (var t = 0; t < textish.length; t++) {
    var te = textish[t];
    // Centered, right-aligned and justified text START AT DIFFERENT X BY
    // DESIGN — that is what the alignment means. Judging them here reported
    // every centered paragraph in the fleet as a missing hanging indent.
    var teAlign = getComputedStyle(te).textAlign;
    if (teAlign !== "left" && teAlign !== "start" && teAlign !== "justify") continue;
    var rr = lineRects(te);
    if (!rr || rr.length < 2) continue;
    var d = Math.round(rr[0].left - rr[1].left);
    // >= 4px for the same reason as the stack check: smaller is glyph metrics.
    if (d >= 4 && d <= MAXI) {
      wrapped.push({
        delta: d,
        text: (te.innerText || "").trim().slice(0, 60).replace(/\s+/g, " "),
        tag: te.tagName.toLowerCase()
      });
    }
  }

  return { contrast: contrast, ragged: ragged, wrapped: wrapped, stacksSeen: seen };
})()`;

async function main() {
  const { chromium } = loadPlaywright();
  const sites = await discoverSites();
  console.log(`fleet UI audit — ${sites.length} site(s)\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const report = [];

  for (const site of sites) {
    const page = await ctx.newPage();
    try {
      // NOT networkidle: a page holding an SSE stream or a poll never goes
      // idle, so the wait resolves on a timeout and measures the server-rendered
      // shell — a clean ✓ over a page never actually examined.
      await page.goto(site, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      const r = await page.evaluate(MEASURE);
      const badContrast = r.contrast.filter((c) => c.value < c.floor);
      report.push({ site, ...r, badContrast });
      console.log(
        `${site}\n  ${r.contrast.length} actions (${badContrast.length} below AA) · ` +
        `${r.stacksSeen} stacks (${r.ragged.length} ragged) · ${r.wrapped.length} unaligned wraps`
      );
    } catch (e) {
      console.log(`${site}\n  ! ${e.message}`);
      report.push({ site, error: e.message, contrast: [], ragged: [], wrapped: [], badContrast: [] });
    } finally {
      await page.close();
    }
  }
  await browser.close();

  let defects = 0;
  for (const r of report) {
    const total = r.badContrast.length + r.ragged.length + r.wrapped.length;
    if (!total) continue;
    defects += total;
    console.log(`\n── ${r.site} ──`);
    for (const c of r.badContrast.sort((a, b) => a.value - b.value)) {
      console.log(
        `  contrast ${String(c.value).padStart(5)}:1 (needs ${c.floor})  <${c.tag}> ${c.fontSize}px  "${c.text}"`
      );
    }
    for (const g of r.ragged) {
      console.log(`  ragged stack: ${g.rows} rows, ${g.spread}px spread, edges ${g.edges.join("/")}`);
      for (const s of g.sample) console.log(`      ${s}`);
    }
    for (const w of r.wrapped) {
      console.log(`  wrapped line off by ${w.delta}px  <${w.tag}>  "${w.text}"`);
    }
  }

  console.log(
    defects === 0
      ? "\n✓ no rendered UI defects found"
      : `\n${defects} rendered UI defect(s) across ${report.filter((r) => r.badContrast.length + r.ragged.length + r.wrapped.length).length} site(s)`
  );
  process.exit(defects && !WARN_ONLY ? 1 : 0);
}

// Import-safe: the self-test imports MEASURE and must not trigger a sweep.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
