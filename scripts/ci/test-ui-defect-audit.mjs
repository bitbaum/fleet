#!/usr/bin/env node
/**
 * Self-test for ui-defect-audit.mjs.
 * Run: node scripts/ci/test-ui-defect-audit.mjs
 *
 * A detector is only worth its output if BOTH sides are pinned. The first draft
 * of this audit flagged 88 "defects" across 14 sites, and most of the alignment
 * ones were a heading followed by consistently indented items — correct markup
 * reported as broken. A rule that fires on everything is as useless as one that
 * fires on nothing, and it is more expensive, because someone has to read it.
 *
 * So every fixture below asserts a VERDICT, not just a run:
 *   - the real fleetcrown bug is still caught (positive)
 *   - correct markup stays silent (negative)
 *
 * Fixtures are inline data: URLs — no network, no fleet, no auth.
 */
import { loadPlaywright, MEASURE } from "./ui-defect-audit.mjs";

const FIXTURES = {
  // ── navigation fixtures ───────────────────────────────────────────────────

  // The orangecat sidebar as it shipped: the section title is an <h3> in a
  // <div>, and the ONLY thing carrying the click is the chevron beside it.
  // Visitors aimed at the word "Fund" and nothing happened.
  navDeadLabel: `
    <div style="background:#0d0d0d;color:#e6e6e6;font:14px sans-serif;padding:16px;width:280px">
      <nav aria-label="Main">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0 12px">
          <h3 style="font-size:12px;text-transform:uppercase;margin:0">Fund</h3>
          <button style="width:44px;height:44px;background:none;border:0;color:#aaa">
            <svg aria-hidden="true" width="16" height="16"></svg>
          </button>
        </div>
      </nav>
    </div>`,

  // The same row done correctly: the label lives INSIDE the control, so the
  // whole row is the target. This must stay silent.
  navLabelInsideControl: `
    <div style="background:#0d0d0d;color:#e6e6e6;font:14px sans-serif;padding:16px;width:280px">
      <nav aria-label="Main">
        <button aria-expanded="true" style="display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;padding:0 12px;background:none;border:0;color:#e6e6e6">
          <h3 style="font-size:12px;text-transform:uppercase;margin:0">Fund</h3>
          <svg aria-hidden="true" width="16" height="16"></svg>
        </button>
      </nav>
    </div>`,

  // A nav containing a link to the page we are on, with nothing announcing it.
  navUnmarkedCurrent: `
    <div style="background:#fff;color:#111;font:14px sans-serif;padding:16px">
      <nav aria-label="Primary">
        <a href="/here" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">Here</a>
        <a href="/elsewhere" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">Elsewhere</a>
      </nav>
    </div>`,

  // The same nav, announcing correctly.
  navMarkedCurrent: `
    <div style="background:#fff;color:#111;font:14px sans-serif;padding:16px">
      <nav aria-label="Primary">
        <a href="/here" aria-current="page" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">Here</a>
        <a href="/elsewhere" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">Elsewhere</a>
      </nav>
    </div>`,

  // A nav of outbound links only — it legitimately contains no link to the
  // current page, so "no aria-current" is CORRECT here and must stay silent.
  navNoSelfLink: `
    <div style="background:#fff;color:#111;font:14px sans-serif;padding:16px">
      <nav aria-label="Elsewhere">
        <a href="/a" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">A</a>
        <a href="/b" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;padding:0 12px">B</a>
      </nav>
    </div>`,

  // Targets below the fleet's 44px floor.
  navSmallTargets: `
    <div style="background:#fff;color:#111;font:14px sans-serif;padding:16px">
      <nav aria-label="Compact">
        <a href="/x" aria-current="page" style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center">X</a>
        <a href="/y" style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center">Y</a>
      </nav>
    </div>`,
  // The original fleetcrown fleet card: an icon INLINE at the head of two of
  // the four rows, shoving only those lines sideways by its own width, and a
  // wrapped hint whose second line falls back to the container edge.
  raggedStack: `
    <div style="background:#070707;color:#e4e4e4;font:14px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:4px;width:600px">
        <p style="margin:0">Fleet autopilot</p>
        <p style="margin:0"><span aria-hidden="true" style="display:inline-block;width:6px;height:6px;background:#4ade80;border-radius:9999px"></span> Idle — nothing queued</p>
        <div style="display:flex;gap:8px"><span>0 working</span><span>21 idle</span></div>
        <p style="margin:0"><svg aria-hidden="true" width="12" height="12" style="display:inline"></svg> Autopilot on — agents work through each project's queue, then pick the next-best task automatically and keep going until the queue is empty.</p>
      </div>
    </div>`,

  // The SAME visual family done correctly: icons hang in a fixed gutter, every
  // row shares one text column, the wrapped line has a hanging indent.
  fixedStack: `
    <div style="background:#070707;color:#e4e4e4;font:14px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:4px;width:600px">
        <p style="margin:0;padding-left:20px">Fleet autopilot</p>
        <p style="margin:0;padding-left:20px;text-indent:-20px"><span aria-hidden="true" style="display:inline-block;width:20px;height:6px"></span>Idle — nothing queued</p>
        <div style="display:flex;gap:8px;padding-left:20px"><span>0 working</span><span>21 idle</span></div>
        <p style="margin:0;padding-left:20px;text-indent:-20px"><span aria-hidden="true" style="display:inline-block;width:20px;height:12px"></span>Autopilot on — agents work through each project's queue, then pick the next-best task automatically and keep going until the queue is empty.</p>
      </div>
    </div>`,

  // Correct markup that the first draft wrongly flagged: a label, then items
  // deliberately indented under it. The column goes out once and STAYS — no
  // return to a previous edge, so it is structure, not raggedness.
  intentionalIndent: `
    <div style="background:#070707;color:#e4e4e4;font:14px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:4px;width:600px">
        <p style="margin:0">GUT · BRAIN AXIS</p>
        <p style="margin:0;padding-left:13px">Vollständige Mikrobiomanalyse</p>
        <p style="margin:0;padding-left:13px">Darmpermeabilitätsmarker</p>
        <p style="margin:0;padding-left:13px">Neurotransmitter-Vorläuferstatus</p>
      </div>
    </div>`,

  // An action below the AA floor, and one comfortably above it.
  contrast: `
    <div style="background:#030303;font:12px sans-serif;padding:24px">
      <a href="#dim" style="color:#5d5d5d">Full inbox — screenshots, history, widget setup</a>
      <br>
      <a href="#ok" style="color:#8f8f8f">New feedback</a>
    </div>`,

  // Chips on a 4%-white overlay over near-black. A naive single canvas paint
  // resolves that overlay to SOLID WHITE and reports these as failures.
  translucentChips: `
    <div style="background:#030303;font:12px sans-serif;padding:24px">
      <button style="color:#e4e4e4;background:oklch(1 0 0 / 0.04);border:0;padding:4px 10px">0 working</button>
      <button style="color:#e4e4e4;background:oklch(1 0 0 / 0.04);border:0;padding:4px 10px">21 idle</button>
    </div>`,
// A nested GROUP between peer lines. datacat renders exactly this: a card
  // title, a description, an icon checklist, then a CTA back at the card edge.
  // The checklist is indented because it is a group, not because anything is
  // broken — and the CTA returning to the base indent is what made the first
  // draft call it ragged.
  nestedGroup: `
    <div style="background:#fff;color:#111;font:14px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:12px;width:600px">
        <h3 style="margin:0">Formular-Erfassung</h3>
        <p style="margin:0">Erstellen Sie benutzerdefinierte Formulare für Umfragen.</p>
        <div style="padding-left:24px">
          <div>KI-gestützte Sentiment-Analyse</div>
          <div>Automatische Kategorisierung</div>
          <div>Trend-Erkennung</div>
        </div>
        <a href="#x" style="color:#4338ca">Formular erstellen →</a>
      </div>
    </div>`,

  // Centered copy. Every line starts at a different x BY DESIGN.
  centeredCopy: `
    <div style="background:#fff;color:#111;font:16px sans-serif;padding:24px">
      <p style="text-align:center;max-width:420px;margin:0 auto">Every feature — health tracking, digital twin, vet network, marketplace, and adoption listings — is included free with no pet limits.</p>
    </div>`,

  // A bare wrapper anchor around a styled button. The anchor's own ink is
  // never painted — the button paints the label — so measuring the anchor read
  // 1:1 on surf-your-life's "Konto erstellen". The button itself passes.
  wrapperAnchor: `
    <div style="background:#fff;font:16px sans-serif;padding:24px">
      <a href="#go" style="color:#fff;text-decoration:none"><button style="background:#0f766e;color:#fff;border:0;padding:12px 24px;font-size:18px">Konto erstellen</button></a>
    </div>`,

  // A disabled control is dim BECAUSE it is disabled — WCAG exempts it. Its
  // enabled twin with the same colors is a real finding.
  disabledControl: `
    <div style="background:#fff;font:14px sans-serif;padding:24px">
      <button disabled style="background:#f4f4f4;color:#9a9a9a;border:0;padding:8px 16px">Send</button>
      <button style="background:#f4f4f4;color:#9a9a9a;border:0;padding:8px 16px">Send twin</button>
    </div>`,

  // A row of padded buttons in a text column: the BUTTON BOX is flush with the
  // column and only the labels sit padding deeper — aoz-wohnen's hero read as
  // ragged for exactly this.
  buttonRow: `
    <div style="background:#fff;color:#111;font:16px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:12px;width:600px">
        <h1 style="margin:0;font-size:24px">Gemeinsam wohnen</h1>
        <p style="margin:0">Die Wohnung, auf die ihr euch einigen könnt.</p>
        <div style="display:flex;gap:12px"><a href="#d" style="background:#ba222e;color:#fff;padding:10px 16px;text-decoration:none">Ausprobieren</a><a href="#l" style="border:1px solid #ccc;color:#111;padding:10px 16px;text-decoration:none">Anmelden</a></div>
        <p style="margin:0">Kein Konto nötig.</p>
      </div>
    </div>`,

  // The same hero with the button row genuinely off the column: the BOX edge
  // returns 16px out and back, and the box edge is what must be measured.
  buttonRowRagged: `
    <div style="background:#fff;color:#111;font:16px sans-serif;padding:24px">
      <div style="display:flex;flex-direction:column;gap:12px;width:600px">
        <h1 style="margin:0;font-size:24px">Gemeinsam wohnen</h1>
        <p style="margin:0">Die Wohnung, auf die ihr euch einigen könnt.</p>
        <div style="display:flex;gap:12px;margin-left:16px"><a href="#d" style="background:#ba222e;color:#fff;padding:10px 16px;text-decoration:none">Ausprobieren</a><a href="#l" style="border:1px solid #ccc;color:#111;padding:10px 16px;text-decoration:none">Anmelden</a></div>
        <p style="margin:0">Kein Konto nötig.</p>
      </div>
    </div>`,
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const measure = async (html) => {
    await page.setContent(`<!doctype html><meta charset="utf-8">${html}`, { waitUntil: "load" });
    await page.waitForTimeout(120);
    return page.evaluate(MEASURE);
  };

  // The nav detectors compare each link's pathname against location.pathname,
  // which setContent alone cannot exercise: an about:blank page has no path to
  // match. Serve the fixture from a routed URL so "the link to the page you are
  // on" is a real condition rather than one the test can never reach.
  const measureAt = async (html, path) => {
    const url = `https://fixture.test${path}`;
    await page.route("https://fixture.test/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8">${html}`,
      }),
    );
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(120);
    const r = await page.evaluate(MEASURE);
    await page.unroute("https://fixture.test/**");
    return r;
  };

  let passed = 0;
  const check = async (label, fn) => {
    await fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  await check("catches the ragged stack it was written for", async () => {
    const r = await measure(FIXTURES.raggedStack);
    assert(r.ragged.length >= 1, "the zigzag stack must be reported");
    assert(
      r.ragged.some((g) => g.spread >= 4 && g.spread <= 24),
      `spread must land in the accidental-indent band, got ${JSON.stringify(r.ragged.map((g) => g.spread))}`,
    );
  });

  await check("catches the wrapped line with no hanging indent", async () => {
    const r = await measure(FIXTURES.raggedStack);
    assert(r.wrapped.length >= 1, "line 2 starting left of line 1 must be reported");
  });

  await check("stays silent once the gutter fix is applied", async () => {
    const r = await measure(FIXTURES.fixedStack);
    assert(r.ragged.length === 0, `fixed stack must be clean, got ${JSON.stringify(r.ragged)}`);
    assert(r.wrapped.length === 0, `hanging indent must be clean, got ${JSON.stringify(r.wrapped)}`);
  });

  await check("does NOT flag a label with deliberately indented items", async () => {
    const r = await measure(FIXTURES.intentionalIndent);
    assert(
      r.ragged.length === 0,
      `structure must not read as raggedness, got ${JSON.stringify(r.ragged)}`,
    );
  });

  await check("reports a sub-AA action and spares a passing one", async () => {
    const r = await measure(FIXTURES.contrast);
    const dim = r.contrast.find((c) => c.href === "#dim");
    const ok = r.contrast.find((c) => c.href === "#ok");
    assert(dim && dim.value < dim.floor, `dim link must fail, got ${dim && dim.value}`);
    assert(ok && ok.value >= ok.floor, `readable link must pass, got ${ok && ok.value}`);
  });

  await check("composites translucent chips instead of calling them white", async () => {
    const r = await measure(FIXTURES.translucentChips);
    const chips = r.contrast.filter((c) => /working|idle/.test(c.text));
    assert(chips.length === 2, `expected 2 chips, got ${chips.length}`);
    for (const c of chips) {
      assert(
        c.value >= c.floor,
        `light text on a 4%-white overlay over near-black is readable; got ${c.value}:1 ` +
        `(a single canvas paint reports ~3.2 here)`,
      );
    }
  });

  await check("does NOT flag a nested group between peer lines", async () => {
    const r = await measure(FIXTURES.nestedGroup);
    assert(
      r.ragged.length === 0,
      `an indented list between a description and a CTA is structure, got ${JSON.stringify(r.ragged)}`,
    );
  });

  await check("ignores a wrapper anchor whose label a nested button paints", async () => {
    const r = await measure(FIXTURES.wrapperAnchor);
    assert(!r.contrast.some((c) => c.tag === "a"), `the wrapper <a> must be skipped, got ${JSON.stringify(r.contrast)}`);
    const btn = r.contrast.find((c) => c.tag === "button");
    assert(btn && btn.value >= btn.floor, `the painted button passes on its own fill, got ${btn && btn.value}`);
  });

  await check("exempts a disabled control but reports its enabled twin", async () => {
    const r = await measure(FIXTURES.disabledControl);
    assert(!r.contrast.some((c) => c.text === "Send"), "the disabled button is exempt (WCAG inactive)");
    const twin = r.contrast.find((c) => c.text === "Send twin");
    assert(twin && twin.value < twin.floor, `the enabled twin is a real finding, got ${twin && twin.value}`);
  });

  await check("measures a padded button row by its box edge, not its label", async () => {
    const r = await measure(FIXTURES.buttonRow);
    assert(r.ragged.length === 0, `a flush button row is aligned, got ${JSON.stringify(r.ragged)}`);
  });

  await check("still catches a button row whose box is off the column", async () => {
    const r = await measure(FIXTURES.buttonRowRagged);
    assert(r.ragged.length >= 1, "a 16px box offset that returns must be reported");
  });

  await check("does NOT flag centered copy as a missing hanging indent", async () => {
    const r = await measure(FIXTURES.centeredCopy);
    assert(
      r.wrapped.length === 0,
      `centered lines start at different x by design, got ${JSON.stringify(r.wrapped)}`,
    );
  });


  await check("catches a nav label that is not the control (the orangecat sidebar bug)", async () => {
    const r = await measure(FIXTURES.navDeadLabel);
    // innerText is the RENDERED text, so `text-transform: uppercase` reports
    // "FUND" and not the "Fund" in the source. Compare case-insensitively —
    // the detector is right and a case-sensitive assertion would be the bug.
    assert(
      r.navDeadLabels.length === 1 &&
        r.navDeadLabels[0].label.toLowerCase() === "fund",
      `the stranded "Fund" heading must be reported, got ${JSON.stringify(r.navDeadLabels)}`,
    );
  });

  await check("stays silent when the label lives inside the control", async () => {
    const r = await measure(FIXTURES.navLabelInsideControl);
    assert(
      r.navDeadLabels.length === 0,
      `a full-row button is correct markup, got ${JSON.stringify(r.navDeadLabels)}`,
    );
  });

  await check("catches a current page that no link announces", async () => {
    const r = await measureAt(FIXTURES.navUnmarkedCurrent, "/here");
    assert(
      r.navMissingCurrent.length === 1 && r.navMissingCurrent[0].href === "/here",
      `the unmarked self-link must be reported, got ${JSON.stringify(r.navMissingCurrent)}`,
    );
  });

  await check("stays silent when the current page IS announced", async () => {
    const r = await measureAt(FIXTURES.navMarkedCurrent, "/here");
    assert(
      r.navMissingCurrent.length === 0,
      `aria-current is present, got ${JSON.stringify(r.navMissingCurrent)}`,
    );
  });

  await check("does NOT demand aria-current from a nav with no link to this page", async () => {
    // A footer of outbound links has no current page to mark. Flagging it would
    // make the detector fire on every site that has one.
    const r = await measureAt(FIXTURES.navNoSelfLink, "/somewhere-else");
    assert(
      r.navMissingCurrent.length === 0,
      `no self-link means nothing to announce, got ${JSON.stringify(r.navMissingCurrent)}`,
    );
  });

  await check("catches nav targets below the 44px floor", async () => {
    const r = await measureAt(FIXTURES.navSmallTargets, "/x");
    assert(
      r.navSmallTargets.length === 2,
      `both 32px targets must be reported, got ${JSON.stringify(r.navSmallTargets)}`,
    );
  });

  await check("stays silent on nav targets that meet the floor", async () => {
    const r = await measureAt(FIXTURES.navMarkedCurrent, "/here");
    assert(
      r.navSmallTargets.length === 0,
      `44px targets are fine, got ${JSON.stringify(r.navSmallTargets)}`,
    );
  });

  await browser.close();
  console.log(`\n${passed}/${passed} ui-defect-audit self-tests passed`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
