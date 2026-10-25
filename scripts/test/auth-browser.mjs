/** pnpm exposes direct dependencies only; either public Playwright API is valid. */
export function authChromium(require) {
  for (const name of ['playwright', '@playwright/test']) {
    let resolved;
    try {
      resolved = require.resolve(name);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    // Loading a resolved but broken package must fail, rather than hide its error.
    const driver = require(resolved);
    if (!driver.chromium?.launch) throw new Error(`${name} does not export a Chromium driver`);
    return driver.chromium;
  }
  throw new Error('Account journey requires a direct playwright or @playwright/test devDependency');
}
