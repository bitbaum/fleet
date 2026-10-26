import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Product checks run only inside the synthetic authenticated local journey. */
export async function checkAuthIntegration(modulePath, context, root = process.cwd()) {
  if (!modulePath) return;
  const base = realpathSync(root);
  const target = realpathSync(resolve(base, modulePath));
  if (!target.startsWith(base + sep) || !target.endsWith('.mjs'))
    throw new Error('Integration check must be an .mjs file within this product');
  const check = await import(pathToFileURL(target).href);
  if (typeof check.run !== 'function') throw new Error('Integration check must export run');
  await check.run(context);
}
