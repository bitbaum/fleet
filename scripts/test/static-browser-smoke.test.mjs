import assert from 'node:assert/strict';
import test from 'node:test';

import { GOOGLE_FONTS, shotName, smoke, WIDTHS } from './static-browser-smoke.mjs';

test('phone, small phone and desktop', () => {
  assert.deepEqual(WIDTHS, [320, 390, 1280]);
});

test('screenshot names are one per path and width', () => {
  assert.equal(shotName('/', 390), 'home-390.png');
  assert.equal(shotName('/de/über-uns/', 320), 'de_ber-uns-320.png');
});

test('only Google Fonts hosts count as Google Fonts', () => {
  assert.ok(GOOGLE_FONTS.test('https://fonts.googleapis.com/css2?family=Inter'));
  assert.ok(GOOGLE_FONTS.test('https://fonts.gstatic.com/s/inter/v13/x.woff2'));
  assert.ok(!GOOGLE_FONTS.test('https://example.com/?u=https://fonts.gstatic.com/'));
  assert.ok(!GOOGLE_FONTS.test('http://127.0.0.1:3100/_next/static/media/inter_latin.woff2'));
});

/** A fake Chromium whose pages answer `status` and request `requests`. */
function fakeChromium({ status, requests = [], overflow = 0 }) {
  return {
    async launch() {
      return {
        async newPage() {
          const handlers = [];
          return {
            on: (_, fn) => handlers.push(fn),
            async goto() {
              for (const url of requests) handlers.forEach((fn) => fn({ url: () => url }));
              return { status: () => status };
            },
            evaluate: async (fn) => (String(fn).includes('scrollWidth') ? overflow : undefined),
            screenshot: async () => {},
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
  };
}

const out = `${process.env.TMPDIR || '/tmp'}/static-browser-smoke-test`;

test('a Google Fonts request fails, at every width', async () => {
  const chromium = fakeChromium({ status: 200, requests: ['https://fonts.gstatic.com/a.woff2'] });
  const { failures } = await smoke({ chromium, base: 'http://x', paths: ['/'], out });
  assert.equal(failures.length, 3);
});

test('an error status fails; overflow only warns', async () => {
  const { failures, warnings } = await smoke({
    chromium: fakeChromium({ status: 500, overflow: 12 }),
    base: 'http://x',
    paths: ['/'],
    out,
  });
  assert.equal(failures.length, 3);
  assert.equal(warnings.length, 3);
});

test('a clean page passes', async () => {
  const result = await smoke({ chromium: fakeChromium({ status: 200 }), base: 'http://x', paths: ['/', '/de'], out });
  assert.deepEqual(result, { failures: [], warnings: [] });
});
