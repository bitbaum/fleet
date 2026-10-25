import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authChromium } from './auth-browser.mjs';
function loader(packages) {
  const require = name => packages[name];
  require.resolve = name => {
    if (!(name in packages)) throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' });
    return name;
  };
  return require;
}
test('works with direct playwright and pnpm-isolated @playwright/test', () => {
  const chromium = { launch() {} };
  for (const name of ['playwright', '@playwright/test']) assert.equal(authChromium(loader({ [name]: { chromium } })), chromium);
});
test('missing dependencies explain the consumer requirement', () => {
  assert.throws(() => authChromium(loader({})), /direct playwright or @playwright\/test/);
});
test('an installed broken package cannot be hidden by fallback', () => {
  assert.throws(() => authChromium(loader({ playwright: {}, '@playwright/test': { chromium: { launch() {} } } })), /does not export/);
  const require = () => { throw Object.assign(new Error('broken dependency'), { code: 'MODULE_NOT_FOUND' }); };
  require.resolve = name => name;
  assert.throws(() => authChromium(require), /broken dependency/);
});
