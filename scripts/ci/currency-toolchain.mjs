import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve toolchain declarations at the projects whose locks will be updated. */
export function currencyToolchain(bumps, exists, readManifest) {
  const pnpm = [];
  for (const bump of bumps) {
    let dir = posix.dirname(bump.path);
    for (;;) {
      if (exists(posix.join(dir, 'pnpm-lock.yaml'))) {
        const candidates = [posix.join(dir, 'package.json'), bump.path];
        const manifest = candidates.find(path => exists(path) && /^pnpm@/.test(readManifest(path).packageManager ?? ''));
        if (!manifest) throw new Error(`No declared pnpm toolchain for ${bump.path}`);
        pnpm.push(manifest);
        break;
      }
      if (exists(posix.join(dir, 'package-lock.json'))) break;
      if (dir === '.') throw new Error(`No supported lockfile for ${bump.path}`);
      dir = posix.dirname(dir);
    }
  }
  return { needed: pnpm.length > 0, manifest: pnpm[0] ?? '' };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const selected = currencyToolchain(JSON.parse(process.env.BUMPS), existsSync, path => JSON.parse(readFileSync(path, 'utf8')));
  console.log(`needed=${selected.needed}\nmanifest=${selected.manifest}`);
}
