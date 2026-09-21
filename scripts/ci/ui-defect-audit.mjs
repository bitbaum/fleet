#!/usr/bin/env node
/**
 * Fleet audit: rendered defects that no unit test, type check or lint rule
 * can see, because nothing is wrong until the page is painted — and, since
 * 2026-09-21, painted at more than one width.
 *
 *   1. INVISIBLE ACTIONS — an interactive label below its WCAG AA contrast
 *      floor. On loki/control the only route to a feedback report's
 *      screenshot and history rendered at 3.13:1; the operator's report was not
 *      "low contrast", it was "i dont see it". An action nobody can find is a
 *      feature that does not exist.
 *
 *   2. RAGGED STACKS — sibling lines in one vertical stack that start at
 *      slightly different x, and wrapped lines whose second line does not align
 *      with the first. Both come from the same habit: putting an icon INLINE at
 *      the head of a line, so it shoves that one line sideways by its own width
 *      and gives a wrapped paragraph no hanging indent. On loki's fleet
 *      card four stacked rows started at three different x (369 / 383 / 385)
 *      with the hint's second line snapping back to 369. The operator's words
 *      were "this area looks bad. not aligned."
 *
 * Central auditor, same doctrine as verify-floor-audit.sh: ONE script that
 * reads every SITE remotely, never a check copied into each repo. A copied
 * check drifts; this one cannot.
 *
 * The site list is DISCOVERED, not hardcoded: loki's public footer is the
 * fleet's own SSOT for "sites we run" (config/fleet-sites.ts renders there
 * precisely so each has a crawlable anchor). Reading it live means a new site
 * is audited the day it is linked, and a retired one stops being audited,
 * without anyone editing this file.
 *
 *   3. CONTROLS OFF THE SCREEN — a nav or header control with part of itself
 *      past the viewport edge, and a page that scrolls sideways. Both only
 *      exist at a width, and for its first year this audit rendered exactly
 *      one (1440). substrata's mobile menu opened 22rem off the LEFT of a
 *      390px screen for months with every other rule green; the first
 *      three-width sweep found the same class live on surf-your-life (93px),
 *      vitareba (19px) and kivvi (15px, plus 15px of sideways scroll), every
 *      one of them clean at 1440.
 *
 * SCOPE — what this does NOT prove. It renders each site's PUBLIC entry page
 * only, unauthenticated. Defects behind a login are invisible here; for those,
 * run the per-repo authed audits (loki: `npm run audit:contrast`). It
 * also judges only text it can attribute to a background — an element painted
 * over an image reports the image's absence, not its colour, so those are
 * skipped rather than guessed at.
 *
 * Usage:
 *   node scripts/ci/ui-defect-audit.mjs                 # audit, exit 1 on defects
 *   node scripts/ci/ui-defect-audit.mjs --warn-only     # report, always exit 0
 *   SITES="https://a.example,https://b.example" node scripts/ci/ui-defect-audit.mjs
 *   VIEWPORTS="390x844,1440x1000" node scripts/ci/ui-defect-audit.mjs
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
const DISCOVERY_URL = process.env.DISCOVERY_URL ?? "https://loki.orangecat.ch/";

/**
 * The widths every site is rendered at.
 *
 * This audit ran at 1440 only until 2026-09-21, and that was the hole it could
 * not see through. substrata's header shipped a mobile menu whose panel was
 * positioned against a button in the middle of the bar, so at 390px it opened
 * 22rem to the LEFT of that button — the search field and every link label
 * painted off the side of the screen. Every rule here passed: the links had
 * boxes, they cleared 44px, the current page carried aria-current. They were
 * simply not on the screen, and nothing rendered the screen they were missing
 * from. The same header hid its whole nav between 768 and 1099px.
 *
 * Three widths, because each is a different layout branch in this fleet's CSS:
 * a phone below every breakpoint, a tablet in the gap where `md:` has fired and
 * `lg:` has not (where both of substrata's defects lived), and the desktop this
 * audit already covered.
 */
const DEFAULT_VIEWPORTS = "390x844,834x1112,1440x1000";

export function parseViewports(spec = process.env.VIEWPORTS) {
  return (spec?.trim() || DEFAULT_VIEWPORTS)
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [w, h] = pair.split("x").map((n) => Number.parseInt(n, 10));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
        throw new Error(`bad viewport "${pair}" — expected WIDTHxHEIGHT, e.g. 390x844`);
      }
      return { width: w, height: h, label: String(w) };
    });
}

export function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_FROM,
    join(homedir(), "dev", "loki"),
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
  // The audit runs FROM loki's own page; auditing the page we discovered
  // from is still worth doing, so it stays in the list.
  found.add("https://loki.orangecat.ch");
  return [...found].sort();
}

/**
 * Open what the nav hides, before measuring it.
 *
 * A menu panel is closed on arrival, so a panel that paints off the side of the
 * screen is invisible to a detector that only measures what is already open —
 * which is exactly how substrata's shipped for months. `<details>` is opened by
 * setting the property rather than clicking it: no event fires, so nothing can
 * navigate, and there is no state for a click handler to get wrong.
 *
 * Buttons are NOT touched here; `main()` clicks those with a URL guard,
 * because a `button[aria-expanded]` in this fleet may be anything at all.
 *
 * Returns how many it opened, so a run can say whether it saw any panel.
 */
export const DISCLOSE = String.raw`(() => {
  var opened = 0;
  var roots = document.querySelectorAll('nav, [role="navigation"], header');
  for (var i = 0; i < roots.length; i++) {
    var ds = roots[i].querySelectorAll("details");
    for (var j = 0; j < ds.length; j++) {
      if (!ds[j].open) { ds[j].open = true; opened++; }
    }
  }
  return opened;
})()`;

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

  // ── navigation ────────────────────────────────────────────────────────────
  // Three defects a fleet-wide nav audit found in 20 repos, all invisible to
  // every check that only looks for forbidden strings, because each is
  // something someone FORGOT rather than something someone wrote.
  //
  // Rendered rather than grepped on purpose: this fleet holds Next apps, CSS
  // modules, Tailwind, and one hand-rolled static generator with no framework
  // at all. No source-level lint spans that. The DOM does.
  var navMissingCurrent = [];
  var navSmallTargets = [];
  var navDeadLabels = [];
  var navOffViewport = [];

  var navRoots = document.querySelectorAll('nav, [role="navigation"]');
  var here = location.pathname.replace(/\/+$/, "") || "/";

  for (var n = 0; n < navRoots.length; n++) {
    var root = navRoots[n];
    if (!root.getBoundingClientRect().width) continue;

    // 1. AN UNMARKED CURRENT PAGE. Only claimed when a link in this nav really
    //    does point at the page we are on — otherwise a nav that legitimately
    //    contains no self-link (a footer of outbound links) reads as a defect.
    var links = root.querySelectorAll("a[href]");
    var selfLink = null, announced = false;
    for (var l = 0; l < links.length; l++) {
      var a = links[l];
      if (a.getAttribute("aria-current")) announced = true;
      var path;
      try { path = new URL(a.href, location.origin).pathname.replace(/\/+$/, "") || "/"; }
      catch (e) { continue; }
      if (path === here && a.getBoundingClientRect().width > 0) selfLink = a;
    }
    if (selfLink && !announced) {
      navMissingCurrent.push({
        label: (selfLink.innerText || "").trim().slice(0, 40).replace(/\s+/g, " "),
        href: selfLink.getAttribute("href") || "",
        navLabel: root.getAttribute("aria-label") || root.className.slice(0, 40) || "nav"
      });
    }

    // 2. TARGETS BELOW THE FLOOR. 44px is this fleet's own standard, not the
    //    WCAG 2.2 AA minimum of 24px — loki enforces it centrally and
    //    kivvi and wild-spirit state it explicitly, so a nav under it is out of
    //    step with the fleet rather than out of compliance. Say which.
    var controls = root.querySelectorAll('a[href], button, [role="button"], [role="tab"]');
    for (var c = 0; c < controls.length; c++) {
      var ctl = controls[c];
      var cr = ctl.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) continue;
      var ccs = getComputedStyle(ctl);
      if (ccs.visibility === "hidden" || ccs.opacity === "0") continue;
      // A control nested inside another is measured by its parent; skip it so
      // one small icon inside a large row is not reported as the row.
      if (ctl.parentElement && ctl.parentElement.closest('a[href], button')) continue;
      if (cr.height < 44 || cr.width < 44) {
        navSmallTargets.push({
          w: Math.round(cr.width), h: Math.round(cr.height),
          tag: ctl.tagName.toLowerCase(),
          text: (ctl.innerText || ctl.getAttribute("aria-label") || "").trim().slice(0, 30).replace(/\s+/g, " ")
        });
      }
    }

    // 3. A LABEL THAT LOOKS LIKE A CONTROL BUT IS NOT. The orangecat sidebar
    //    shipped this: an <h3> section title beside a chevron-only <button>
    //    that carried the whole onClick. Visitors aimed at the word and nothing
    //    happened. Claimed only when the heading is NOT inside a control and a
    //    sibling control has no text of its own — that pairing is the bug.
    var heads = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (var hI = 0; hI < heads.length; hI++) {
      var head = heads[hI];
      if (head.closest('button, a[href], [role="button"]')) continue;
      var row = head.parentElement;
      if (!row) continue;
      var sibs = row.querySelectorAll('button, [role="button"]');
      for (var sI = 0; sI < sibs.length; sI++) {
        var sib = sibs[sI];
        if (sib.contains(head)) continue;
        if ((sib.innerText || "").trim()) continue;   // it has its own label
        var sr = sib.getBoundingClientRect();
        if (!sr.width) continue;
        navDeadLabels.push({
          label: (head.innerText || "").trim().slice(0, 40).replace(/\s+/g, " "),
          control: Math.round(sr.width) + "x" + Math.round(sr.height)
        });
        break;
      }
    }
  }

  // ── a control half off the screen ─────────────────────────────────────────
  // Added 2026-09-21 after substrata's mobile menu shipped a panel anchored to
  // a button in the middle of the header: position:absolute with right:0
  // measured from THERE put 22rem of panel off the LEFT edge of a 390px
  // screen. Every rule above passed — the links had boxes, cleared 44px and
  // marked the current page. They were simply not on the screen.
  //
  // Its own root set, wider than the three rules above, and that is the
  // finding rather than a convenience: substrata's mobile menu is NOT inside
  // a <nav>. It is a <details> sitting beside one in the header, which is
  // where a menu button usually lives. A rule that only looked inside <nav>
  // would have missed the exact defect it was written for.
  //
  // CROSSING the edge is the defect, not being past it. A closed drawer parked
  // at translateX(-100%) is entirely outside the viewport and is correct; a
  // panel with half its width off the side is not. Requiring part in and part
  // out separates them with no list of exceptions.
  var chromeRoots = document.querySelectorAll('nav, [role="navigation"], header');
  var offSeen = [];
  for (var cr2 = 0; cr2 < chromeRoots.length; cr2++) {
    var croot = chromeRoots[cr2];
    if (!croot.getBoundingClientRect().width) continue;
    var cctl = croot.querySelectorAll('a[href], button, [role="button"], summary');
    for (var o = 0; o < cctl.length; o++) {
      var oc = cctl[o];
      if (offSeen.indexOf(oc) !== -1) continue;   // nested roots see it twice
      offSeen.push(oc);
      var or = oc.getBoundingClientRect();
      if (or.width === 0 || or.height === 0) continue;
      var ocs = getComputedStyle(oc);
      if (ocs.visibility === "hidden" || ocs.opacity === "0") continue;
      if (oc.closest('[aria-hidden="true"], [inert]')) continue;
      // 4px, not 1: the first fleet sweep found loki's "Get started" one pixel
      // past the edge at 834, which is sub-pixel rounding rather than a button
      // anybody sees clipped. The three real ones that run — 15px, 19px, 93px —
      // are nowhere near this floor.
      var off = 0, side = "";
      if (or.left < -4 && or.right > 4) { off = Math.round(-or.left); side = "left"; }
      else if (or.right > innerWidth + 4 && or.left < innerWidth - 4) {
        off = Math.round(or.right - innerWidth); side = "right";
      }
      if (off > 4) {
        navOffViewport.push({
          side: side, off: off,
          w: Math.round(or.width), h: Math.round(or.height),
          tag: oc.tagName.toLowerCase(),
          href: oc.getAttribute("href") || "",
          text: (oc.innerText || oc.getAttribute("aria-label") || "").trim().slice(0, 30).replace(/\s+/g, " ")
        });
      }
    }
  }

  return {
    contrast: contrast, ragged: ragged, wrapped: wrapped, stacksSeen: seen,
    navMissingCurrent: navMissingCurrent,
    navSmallTargets: navSmallTargets,
    navDeadLabels: navDeadLabels,
    navOffViewport: navOffViewport,
    navsSeen: navRoots.length,
    // Sideways scroll on the page itself. Cheap, objective, and a different
    // failure from the one above: content past the RIGHT edge extends
    // scrollWidth, content past the left does not. Over 2px, because a 1px
    // rounding difference is not a page a reader can scroll.
    pageOverflow: (function () {
      var over = Math.round(document.documentElement.scrollWidth - innerWidth);
      return over > 2 ? over : 0;
    })(),
    viewportWidth: innerWidth
  };
})()`;

/**
 * One nav disclosure that only a click opens.
 *
 * `DISCLOSE` handles `<details>` without firing an event. A React menu behind
 * `button[aria-expanded]` needs the click, and a click in this fleet may do
 * anything — so the URL is checked afterwards and a navigation ends the pass
 * rather than auditing whatever page it landed on.
 */
async function openButtonMenus(page) {
  const before = page.url();
  let opened = 0;
  const buttons = await page.$$(
    'nav button[aria-expanded="false"], [role="navigation"] button[aria-expanded="false"], header button[aria-expanded="false"]',
  );
  for (const btn of buttons.slice(0, 6)) {
    try {
      if (!(await btn.isVisible())) continue;
      await btn.click({ timeout: 2000, noWaitAfter: true });
      await page.waitForTimeout(150);
      if (page.url() !== before) return opened; // it navigated; stop touching things
      opened += 1;
    } catch {
      /* a control that will not open is not a finding this audit makes */
    }
  }
  return opened;
}

/** A finding's identity, so the same decision seen at three widths prints once. */
function keyOf(kind, f) {
  switch (kind) {
    case "badContrast": return `${kind}|${f.tag}|${f.text}|${f.value}`;
    // NOT the edges: the same crooked stack sits at a different absolute x at
    // every width, so keying on coordinates prints one decision three times.
    // Its shape — how many rows, how far apart, which lines — is what is wrong.
    // NOT the edges, and not the sample verbatim: the same crooked stack sits
    // at a different absolute x at every width, and each sample line is
    // prefixed with that x ("90:Research desk" / "574:Research desk"), so both
    // print one decision three times. Its shape — how many rows, how far
    // apart, which lines — is what is wrong.
    case "ragged":
      return `${kind}|${f.rows}|${f.spread}|` +
        (f.sample ?? []).map((line) => String(line).replace(/^\s*-?\d+\s*:/, "")).join("~");
    case "wrapped": return `${kind}|${f.tag}|${f.text}`;
    case "navMissingCurrent": return `${kind}|${f.href}|${f.navLabel}`;
    case "navSmallTargets": return `${kind}|${f.w}x${f.h}|${f.tag}|${f.text}`;
    case "navDeadLabels": return `${kind}|${f.label}`;
    case "navOffViewport": return `${kind}|${f.side}|${f.tag}|${f.text}|${f.href}`;
    default: return `${kind}|${JSON.stringify(f)}`;
  }
}

const KINDS = [
  "badContrast", "ragged", "wrapped",
  "navMissingCurrent", "navSmallTargets", "navDeadLabels", "navOffViewport",
];

async function main() {
  const { chromium } = loadPlaywright();
  const sites = await discoverSites();
  const viewports = parseViewports();
  console.log(
    `fleet UI audit — ${sites.length} site(s) x ${viewports.length} width(s) ` +
    `(${viewports.map((v) => v.label).join(", ")})\n`,
  );

  const browser = await chromium.launch();
  // Findings merge per site across widths: one decision is one line, annotated
  // with every width it was seen at. Rendering three times must not treble a
  // report that a human has to read.
  const merged = new Map();
  const siteOf = (site) => {
    if (!merged.has(site)) {
      merged.set(site, {
        site, errors: [], widths: [], navsSeen: 0, stacksSeen: 0, overflow: [],
        found: new Map(),
      });
    }
    return merged.get(site);
  };

  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    for (const site of sites) {
      const entry = siteOf(site);
      const page = await ctx.newPage();
      try {
        // NOT networkidle: a page holding an SSE stream or a poll never goes
        // idle, so the wait resolves on a timeout and measures the server-rendered
        // shell — a clean ✓ over a page never actually examined.
        await page.goto(site, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4000);
        await page.evaluate(DISCLOSE);
        await openButtonMenus(page);
        await page.waitForTimeout(250);
        const r = await page.evaluate(MEASURE);
        entry.widths.push(vp.label);
        entry.navsSeen = Math.max(entry.navsSeen, r.navsSeen);
        entry.stacksSeen = Math.max(entry.stacksSeen, r.stacksSeen);
        if (r.pageOverflow > 0) entry.overflow.push({ at: vp.label, px: r.pageOverflow });
        const findings = { ...r, badContrast: r.contrast.filter((c) => c.value < c.floor) };
        let here = 0;
        for (const kind of KINDS) {
          for (const f of findings[kind] ?? []) {
            here += 1;
            const k = keyOf(kind, f);
            const seen = entry.found.get(k);
            if (seen) seen.at.push(vp.label);
            else entry.found.set(k, { kind, f, at: [vp.label] });
          }
        }
        console.log(
          `${site} @${vp.label}\n  ${r.contrast.length} actions (${findings.badContrast.length} below AA) · ` +
          `${r.navsSeen} navs · ${here} finding(s)` +
          (r.pageOverflow > 0 ? ` · scrolls sideways by ${r.pageOverflow}px` : ""),
        );
      } catch (e) {
        console.log(`${site} @${vp.label}\n  ! ${e.message}`);
        entry.errors.push(`${vp.label}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
    await ctx.close();
  }
  await browser.close();

  const at = (widths) => `[${[...new Set(widths)].join("/")}px]`;
  let defects = 0;

  for (const entry of merged.values()) {
    const total = entry.found.size + entry.overflow.length;
    if (!total) continue;
    defects += total;
    console.log(`\n── ${entry.site} ──`);

    const of = (kind) => [...entry.found.values()].filter((x) => x.kind === kind);

    for (const o of entry.overflow) {
      console.log(`  ${at([o.at])} page scrolls sideways by ${o.px}px`);
    }
    for (const { f, at: w } of of("badContrast").sort((a, b) => a.f.value - b.f.value)) {
      console.log(
        `  ${at(w)} contrast ${String(f.value).padStart(5)}:1 (needs ${f.floor})  <${f.tag}> ${f.fontSize}px  "${f.text}"`,
      );
    }
    for (const { f, at: w } of of("ragged")) {
      console.log(`  ${at(w)} ragged stack: ${f.rows} rows, ${f.spread}px spread, edges ${f.edges.join("/")}`);
      for (const line of f.sample) console.log(`      ${line}`);
    }
    for (const { f, at: w } of of("wrapped")) {
      console.log(`  ${at(w)} wrapped line off by ${f.delta}px  <${f.tag}>  "${f.text}"`);
    }
    for (const { f, at: w } of of("navMissingCurrent")) {
      console.log(
        `  ${at(w)} nav: current page unmarked — "${f.label}" (${f.href}) in [${f.navLabel}] has no aria-current`,
      );
    }
    for (const { f, at: w } of of("navOffViewport")) {
      console.log(
        `  ${at(w)} nav: "${f.text || f.href}" crosses the ${f.side} edge by ${f.off}px ` +
        `(<${f.tag}> ${f.w}x${f.h}) — part of it is off the screen`,
      );
    }
    // One line per distinct SIZE, not per element: a nav of twelve identical
    // 32px links is one decision, and twelve lines of it buries everything else.
    const bySize = new Map();
    for (const { f, at: w } of of("navSmallTargets")) {
      const k = `${f.w}x${f.h} <${f.tag}>`;
      if (!bySize.has(k)) bySize.set(k, { texts: [], widths: [] });
      bySize.get(k).texts.push(f.text);
      bySize.get(k).widths.push(...w);
    }
    for (const [k, { texts, widths }] of bySize) {
      console.log(
        `  ${at(widths)} nav: ${texts.length} target(s) under 44px at ${k} — e.g. "${texts[0]}"` +
        (texts.length > 1 ? ` (+${texts.length - 1} more)` : ""),
      );
    }
    for (const { f, at: w } of of("navDeadLabels")) {
      console.log(
        `  ${at(w)} nav: "${f.label}" looks like a control but is not — only the ${f.control} icon beside it is clickable`,
      );
    }
  }

  const failed = [...merged.values()].filter((e) => e.errors.length && !e.widths.length);
  for (const e of failed) console.log(`\n── ${e.site} ──\n  ! unreachable: ${e.errors.join("; ")}`);

  const dirty = [...merged.values()].filter((e) => e.found.size + e.overflow.length > 0).length;
  console.log(
    defects === 0
      ? "\n✓ no rendered UI defects found"
      : `\n${defects} rendered UI defect(s) across ${dirty} site(s)`,
  );
  // A site nothing could render is not a clean site, and saying so was this
  // script's own stated fear: "a clean report from a broken detector is worse
  // than no report at all". It is not counted as a defect — it is not one —
  // but it is never folded into the ✓ either.
  if (failed.length) {
    console.log(
      `! ${failed.length} site(s) could not be rendered at any width and were NOT audited: ` +
      failed.map((e) => e.site).join(", "),
    );
  }
  process.exit(defects && !WARN_ONLY ? 1 : 0);
}

// Import-safe: the self-test imports MEASURE and must not trigger a sweep.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
