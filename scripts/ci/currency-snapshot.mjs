import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { manifestPaths } from './shared-registry-audit.mjs';
import { lockedDependencies, lockedNpmDependencies } from './package-rollout-gate.mjs';

export function githubJson(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(execFileSync('gh', ['api', path], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
    } catch (error) {
      if (attempt === 2 || !/HTTP (?:401|429|5\d\d)|timed out|ECONNRESET/.test(String(error.stderr ?? error.message))) throw error;
    }
  }
}

/** Public automation cannot publish private repository names in its matrix/log. */
export function repositoriesForCurrency(repos, includePrivate = false) {
  return repos.filter(r => !r.archived && !r.fork && (r.private === false || includePrivate))
    .map(r => r.name).sort();
}
export function currencyRepositories(owner, includePrivate = false, request = githubJson) {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = request(`orgs/${owner}/repos?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Repository census is unavailable');
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repositoriesForCurrency(repos, includePrivate);
}

/** One immutable tree: a moving default branch cannot mix manifests and locks. */
export function currencySnapshot(owner, repo, request = githubJson) {
  const prefix = `repos/${owner}/${repo}`;
  const commit = request(`${prefix}/commits/HEAD`).sha;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Missing source commit');
  const tree = request(`${prefix}/git/trees/${commit}?recursive=1`);
  const paths = manifestPaths(tree); // rejects truncated/unavailable trees
  const files = new Set(tree.tree.filter(e => e.type === 'blob').map(e => e.path));
  const cache = new Map();
  function read(path) {
    if (!files.has(path)) throw new Error(`Missing tracked file: ${path}`);
    if (!cache.has(path)) {
      const file = request(`${prefix}/contents/${path}?ref=${commit}`);
      if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error(`Unreadable file: ${path}`);
      cache.set(path, Buffer.from(file.content, 'base64').toString('utf8'));
    }
    return cache.get(path);
  }
  return {
    commit, paths,
    manifest: path => JSON.parse(read(path)),
    artifacts(path, manifest) {
      let dir = posix.dirname(path);
      for (;;) {
        const pnpm = posix.join(dir, 'pnpm-lock.yaml');
        const npm = posix.join(dir, 'package-lock.json');
        const importer = posix.relative(dir, posix.dirname(path)) || '.';
        if (files.has(pnpm)) return lockedDependencies(manifest, read(pnpm), importer);
        if (files.has(npm)) return lockedNpmDependencies(manifest, JSON.parse(read(npm)), importer);
        if (dir === '.') throw new Error(`Missing supported lockfile: ${path}`);
        dir = posix.dirname(dir);
      }
    },
  };
}
