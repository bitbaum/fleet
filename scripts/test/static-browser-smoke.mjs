#!/usr/bin/env node
// A real Chromium against a site's own production build: every path answers,
// at phone and desktop widths, with nothing fetched from Google Fonts.
//
//   BASE_URL=http://127.0.0.1:3100 SMOKE_PATHS="/ /de" \
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   [BROWSER_EXECUTABLE=/usr/bin/google-chrome] [OUT=browser-smoke-artifacts] \
//   node static-browser-smoke.mjs
//
// It is the browser evidence the package rollout gate asks of a consumer
// (`browser-smoke.yml`) for sites with no account, database or journey of
// their own: content sites whose CI is a build. A shared package that changes
// how such a site looks — tokens, faces — still reaches it with a page that
// was actually drawn, and screenshots a person can look at.
//
// Fails on: a path that does not answer below 400, and any request to
// fonts.googleapis.com or fonts.gstatic.com (the faces ship in
// @bitbaum/design-tokens; a build or a page that still asks Google is the
// regression fleet scripts/ci/google-fonts-audit.sh sweeps for).
// Warns on: a page wider than the viewport — real, and reported, but a
// pre-existing overflow must not hold an unrelated package update.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const WIDTHS = [320, 390, 1280];
export const GOOGLE_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;

/** "/de/about" at 390 → "de_about-390.png"; "/" → "home-390.png". */
export function shotName(path, width) {
  const slug = path.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'home';
  return `${slug}-${width}.png`;
}

export async function smoke({ chromium, base, paths, out, executablePath }) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const failures = [];
  const warnings = [];
  try {
    for (const path of paths) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const google = [];
        page.on('request', (request) => {
          if (GOOGLE_FONTS.test(request.url())) google.push(request.url());
        });
        const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle', timeout: 60000 });
        const status = response?.status() ?? 0;
        if (status === 0 || status >= 400) failures.push(`${path} @${width}px answered ${status || 'nothing'}`);
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) warnings.push(`${path} @${width}px is ${overflow}px wider than the viewport`);
        for (const url of google) failures.push(`${path} @${width}px requested ${url}`);
        await page.screenshot({ path: join(out, shotName(path, width)), fullPage: true });
        console.log(`${path} @${width}px: ${status}, ${google.length} Google Fonts request(s)`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { failures, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE_URL;
  const paths = (process.env.SMOKE_PATHS || '/').split(/\s+/).filter(Boolean);
  if (!base || !process.env.PLAYWRIGHT_CORE) {
    console.error('BASE_URL and PLAYWRIGHT_CORE are required');
    process.exit(2);
  }
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_CORE);
  const { failures, warnings } = await smoke({
    chromium,
    base,
    paths,
    out: process.env.OUT || 'browser-smoke-artifacts',
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  });
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const f of failures) console.log(`::error::${f}`);
  process.exit(failures.length ? 1 : 0);
}
