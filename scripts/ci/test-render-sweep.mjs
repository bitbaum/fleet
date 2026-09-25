#!/usr/bin/env node
/**
 * Self-test for render-sweep.mjs. Run: node scripts/ci/test-render-sweep.mjs
 *
 * Every check is pinned on BOTH sides — the defect fires, correct markup stays
 * silent — because a detector that has quietly stopped firing reports a clean
 * fleet, and a detector that fires on everything is read once and ignored.
 * Mutation-proven when written: disabling each check's core condition in
 * RENDER_MEASURE fails its positive fixture here (see the PR).
 *
 * Fixtures render in real Chromium via page.setContent — no network, no fleet.
 * The pure halves (apps.conf parsing, DENY, merge, tally, ratchet) run first
 * and need no browser.
 */
import {
  CHECKS,
  DENY,
  RENDER_MEASURE,
  findingsOf,
  formatBaseline,
  improvements,
  mergeFindings,
  parseAppsConf,
  readBaseline,
  regressions,
  resolveSites,
  tally,
} from "./render-sweep.mjs";
import { MEASURE, loadPlaywright } from "./ui-defect-audit.mjs";

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
};

// ── pure ─────────────────────────────────────────────────────────────────────
{
  const conf = [
    "# comment",
    "kivvi|4005|kivvi.orangecat.ch|/x|.|kivvi|RevampIT|client-app|live|favour|0|-",
    "gone|4099|gone.orangecat.ch|/x|.|-|bitbaum|product|archived|-|-|-",
    "evig|4004|evig.orangecat.ch,revampit.orangecat.ch|/x|.|r|bitbaum|product|live|-|-|-",
  ].join("\n");
  const rows = parseAppsConf(conf);
  ok(rows.length === 2, "apps.conf: archived rows are not swept");
  ok(rows.find((r) => r.name === "evig")?.url === "https://evig.orangecat.ch", "apps.conf: first domain is the site");
  const sites = resolveSites(conf, {
    extraSites: { loki: { url: "https://loki.orangecat.ch", kind: "product" } },
    pages: { kivvi: ["/", "/api/health", "/admin", "/cron/run", "/how-it-works"] },
  });
  ok(sites.some((s) => s.name === "loki"), "extraSites are swept too");
  const kivvi = sites.find((s) => s.name === "kivvi");
  ok(kivvi.client === true, "a client-app row is marked client (report only, never fixed)");
  ok(
    JSON.stringify(kivvi.paths) === JSON.stringify(["/", "/how-it-works"]),
    `DENY strips api/admin/cron paths even when configured, got ${JSON.stringify(kivvi.paths)}`,
  );
  ok(sites.find((s) => s.name === "evig").paths.join() === "/", "a site without pages gets / only");
  for (const p of ["/api/x", "/admin", "/auth/signin", "/cron", "/jobs/1", "/account", "/settings", "/login?next=/"]) {
    ok(DENY.test(p), `DENY refuses ${p}`);
  }
  for (const p of ["/", "/atlas?view=world", "/blog", "/jobsearch-tips", "/about"]) {
    ok(!DENY.test(p), `DENY allows ${p}`);
  }
  ok(resolveSites(conf, {}, ["kivvi"]).length === 1, "SITES narrows the sweep");

  // merge + ratchet
  const f = { tag: "p", text: "EXTRACT", kicker: true, next: "x" };
  const merged = mergeFindings([
    { site: "a", path: "/", width: "390", findings: [{ check: "empty-heading", f }] },
    { site: "a", path: "/", width: "1440", findings: [{ check: "empty-heading", f }] },
    { site: "a", path: "/b", width: "390", findings: [{ check: "empty-heading", f }] },
  ]);
  const counts = tally(merged);
  ok(counts.a["empty-heading"] === 2, "one finding at two widths counts once; another page counts again");
  ok(merged.get("a").values().next().value.widths.join() === "390,1440", "widths are recorded");
  const base = readBaseline("# c\na empty-heading 2\na split-number 3\n");
  ok(regressions(counts, base).length === 0, "equal to baseline: no regression");
  ok(regressions({ a: { ...counts.a, "empty-heading": 3 } }, base).length === 1, "a rise is a regression");
  ok(regressions({ z: { "fixed-overlap": 1 } }, base).length === 1, "a new site x check starts from 0");
  ok(improvements(counts, base).some((r) => r.check === "split-number"), "a fall is reported as an improvement");
  ok(regressions({}, base).length === 0, "an unmeasured site is not judged (and not read as clean)");
  const round = readBaseline(formatBaseline({ a: { "empty-heading": 2, "split-number": 0 } }));
  ok(round.a["empty-heading"] === 2 && round.a["split-number"] === undefined, "baseline round-trips, zeros omitted");
  ok(
    findingsOf({ pageOverflow: 12, navSmallTargets: [{}], navOffViewport: [] }, {}, ["boom"]).map((x) => x.check).join() ===
      "rule3-small-target,rule8-sideways,page-errors",
    "MEASURE's rule 3/8 results and page errors map onto checks",
  );
  ok(CHECKS.length === 8, "eight ratcheted checks");
}

// ── rendered ─────────────────────────────────────────────────────────────────
const doc = (body) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0;font:16px/1.4 sans-serif}</style></head><body>${body}</body></html>`;

const FIX = {
  // substrata's country panel: a roles label, then a new section's heading.
  orphanLabel: `<div style="width:360px"><h2>India</h2><p style="text-transform:uppercase;letter-spacing:.1em;font-size:12px">extract</p>
    <section><h3>Natural resources, measured</h3><p>Ordered by share of world output.</p></section></div>`,
  // An eyebrow above its own heading is design, not an orphan.
  eyebrow: `<section><p style="text-transform:uppercase;font-size:12px">South Asia · IN</p><h2>India</h2><p>Body.</p></section>`,
  chipAtCardEnd: `<article><h3>Program</h3><p>Twelve weeks.</p><span style="display:block;text-transform:uppercase;background:#eee;padding:2px 6px">90-Tage-Programm</span></article>`,
  emptyH2: `<main><h2>Overview</h2><h2>Details</h2><p>Only details has content.</p></main>`,
  emptyAtEnd: `<main><section><p>Text.</p><h3>Trailing</h3></section><section><p>Next.</p></section></main>`,
  headingWithSub: `<main><h2>Section</h2><h3>Sub</h3><p>Content under sub.</p></main>`,
  headingWithContent: `<main><h2>Section</h2><p>Real content.</p><h2>Next</h2><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20"></main>`,
  cardTitles: `<ul><li><a href="/a"><h3>Tile A</h3></a></li><li><h3>Plain title</h3></li></ul>`,

  splitNumber: `<table style="width:70px"><tr><td style="font-size:16px">282,000 (+10%)</td></tr></table>`,
  splitInToken: `<table><tr><td style="width:60px;word-break:break-all">Total 1,234,567,890 units</td></tr></table>`,
  numberFits: `<table style="width:300px"><tr><td style="white-space:nowrap;font-variant-numeric:tabular-nums">282,000 (+10%)</td><td>A long label that wraps across several lines in this narrow cell is fine</td></tr></table>`,

  fixedOverlap: `<button id="a" style="position:fixed;right:16px;bottom:16px;width:60px;height:60px">Ask</button>
    <button id="b" style="position:fixed;right:30px;bottom:30px;width:60px;height:60px">Chat</button>`,
  fixedApart: `<button style="position:fixed;right:16px;bottom:16px;width:60px;height:60px">Ask</button>
    <nav style="position:fixed;left:0;right:0;top:0;height:48px"><a href="/x" style="display:inline-block;width:60px;height:44px">X</a></nav>`,
  // A nav item scrolled out of its sidebar's clip, "under" the sidebar footer.
  clippedUnder: `<aside style="position:fixed;left:0;top:0;width:220px;height:300px;display:flex;flex-direction:column">
     <div style="flex:1;overflow:auto"><div style="height:260px"></div><a href="/n" style="display:block;height:44px">News</a></div>
     <button style="height:44px">Collapse sidebar</button></aside>`,
  lokiOnButton: `<button id="send" style="position:fixed;right:10px;bottom:10px;width:80px;height:44px">Send</button>
    <div id="loki-feedback-host"></div>
    <script>
      var r = document.getElementById("loki-feedback-host").attachShadow({ mode: "open" });
      r.innerHTML = '<button class="fab" style="position:fixed;right:16px;bottom:14px;width:40px;height:40px;z-index:2147483000">✎</button>';
    </script>`,

  offscreen: `<div><button style="position:relative;left:360px;width:80px;height:44px">Buy</button></div>`,
  carousel: `<div style="overflow-x:auto;white-space:nowrap;width:390px"><button style="width:300px;height:44px">One</button><button style="width:300px;height:44px">Two</button></div>`,
};

async function measure(page, html, width = 390) {
  await page.setViewportSize({ width, height: 700 });
  await page.setContent(doc(html));
  await page.waitForTimeout(50);
  return page.evaluate(RENDER_MEASURE);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  let r = await measure(page, FIX.orphanLabel);
  ok(r.emptyHeading.some((f) => f.text.toUpperCase() === "EXTRACT"), `orphan label caught, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.eyebrow);
  ok(r.emptyHeading.length === 0, `an eyebrow above its heading is silent, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.chipAtCardEnd);
  ok(r.emptyHeading.length === 0, `a chip/badge at a card's end is a tag, not a label, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.emptyH2);
  ok(r.emptyHeading.length === 1 && r.emptyHeading[0].text === "Overview", `h2 followed by h2 is empty, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.emptyAtEnd);
  ok(r.emptyHeading.some((f) => f.text === "Trailing"), `a heading at a section's end is empty, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.headingWithSub);
  ok(r.emptyHeading.length === 0, `h2 → h3 → content is structure, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.headingWithContent);
  ok(r.emptyHeading.length === 0, `headings followed by text / an image are fine, got ${JSON.stringify(r.emptyHeading)}`);
  r = await measure(page, FIX.cardTitles);
  ok(r.emptyHeading.length === 0, `a title inside a link or a list item is not judged, got ${JSON.stringify(r.emptyHeading)}`);

  r = await measure(page, FIX.splitNumber);
  ok(r.splitNumber.length === 1, `a figure wrapped in a narrow cell is caught, got ${JSON.stringify(r.splitNumber)}`);
  r = await measure(page, FIX.splitInToken);
  ok(r.splitNumber.some((f) => f.token.startsWith("1,234")), `a number broken mid-token is caught, got ${JSON.stringify(r.splitNumber)}`);
  r = await measure(page, FIX.numberFits);
  ok(r.splitNumber.length === 0, `a figure on one line (and wrapping prose) is silent, got ${JSON.stringify(r.splitNumber)}`);

  r = await measure(page, FIX.fixedOverlap);
  ok(r.fixedOverlap.length === 1, `two fixed buttons on each other are caught, got ${JSON.stringify(r.fixedOverlap)}`);
  r = await measure(page, FIX.fixedApart);
  ok(r.fixedOverlap.length === 0, `fixed controls apart are silent, got ${JSON.stringify(r.fixedOverlap)}`);
  r = await measure(page, FIX.clippedUnder, 1440);
  ok(r.fixedOverlap.length === 0, `a link scrolled out of its clip is not "covered", got ${JSON.stringify(r.fixedOverlap)}`);
  r = await measure(page, FIX.lokiOnButton);
  ok(r.fixedOverlap.some((f) => f.loki), `the Loki launcher on a host button is caught, got ${JSON.stringify(r.fixedOverlap)}`);

  r = await measure(page, FIX.offscreen);
  ok(r.offscreenControl.length === 1 && r.offscreenControl[0].side === "right", `a control past the right edge is caught, got ${JSON.stringify(r.offscreenControl)}`);
  r = await measure(page, FIX.carousel);
  ok(r.offscreenControl.length === 0, `a control in a horizontal scroller is silent, got ${JSON.stringify(r.offscreenControl)}`);

  // MEASURE (ui-defect-audit) supplies rules 3/7/8; pin that the sweep can read them.
  await page.setContent(doc(`<div style="width:600px;height:10px"></div>`));
  const m = await page.evaluate(MEASURE);
  ok(m.pageOverflow > 0, `rule 8 (sideways scroll) reaches the sweep, got ${m.pageOverflow}`);
} finally {
  await browser.close();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
