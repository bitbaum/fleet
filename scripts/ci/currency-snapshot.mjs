import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { manifestPaths } from './shared-registry-audit.mjs';
import { lockedDependencies, lockedNpmDependencies } from './package-rollout-gate.mjs';
import { withGitHubReadRetry } from './github-api-read.mjs';

export function githubJson(path, { run = execFileSync, wait } = {}) {
  const output = withGitHubReadRetry(() => run('gh', ['api', path], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), { wait });
  return JSON.parse(output);
}

function rawFile(owner, repo, path, commit) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encoded}`;
  return execFileSync('curl', [
    '--fail', '--silent', '--show-error', '--location',
    '--retry', '3', '--retry-all-errors', '--retry-delay', '1', '--retry-max-time', '30',
    '--connect-timeout', '10', '--max-time', '30', url,
  ], {
    encoding: 'utf8', timeout: 45_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
export function currencySnapshot(owner, repo, request = githubJson, readFile = rawFile) {
  const prefix = `repos/${owner}/${repo}`;
  const commit = request(`${prefix}/commits/HEAD`).sha;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Missing source commit');
  const tree = request(`${prefix}/git/trees/${commit}?recursive=1`);
  const paths = manifestPaths(tree); // rejects truncated/unavailable trees
  const files = new Set(tree.tree.filter(e => e.type === 'blob').map(e => e.path));
  const cache = new Map();
  function read(path) {
    if (!files.has(path)) throw new Error(`Missing tracked file: ${path}`);
    if (!cache.has(path)) cache.set(path, readFile(owner, repo, path, commit));
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
