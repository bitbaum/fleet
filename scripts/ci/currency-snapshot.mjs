import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
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

/**
 * Read a public repository's immutable source tree over Git's smart protocol.
 * The old REST path needed two core-API requests per repository (commit +
 * recursive tree), so a 61-repo census consumed 122 calls before examining a
 * manifest. A shallow partial clone transfers commit/tree objects only; files
 * are fetched separately from raw.githubusercontent.com at the captured SHA.
 */
export function publicGitTree(owner, repo, run = execFileSync) {
  const work = mkdtempSync(join(tmpdir(), 'fleet-currency-tree-'));
  const checkout = join(work, 'repo');
  try {
    run('git', ['clone', '--quiet', '--depth=1', '--filter=blob:none', '--no-checkout',
      `https://github.com/${owner}/${repo}.git`, checkout], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const commit = run('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Missing source commit');
    const output = run('git', ['-C', checkout, 'ls-tree', '-r', '-z', '--full-tree', commit], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tree = [];
    for (const record of output.split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      if (tab < 0) throw new Error('Git tree entry is malformed');
      const metadata = record.slice(0, tab).split(' ');
      tree.push({ type: metadata[1], path: record.slice(tab + 1) });
    }
    return { commit, tree: { truncated: false, tree } };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** One immutable tree: a moving default branch cannot mix manifests and locks. */
export function currencySnapshot(owner, repo, request, readFile = rawFile, run = execFileSync) {
  const prefix = `repos/${owner}/${repo}`;
  let source;
  if (request) {
    const commit = request(`${prefix}/commits/HEAD`).sha;
    source = { commit, tree: request(`${prefix}/git/trees/${commit}?recursive=1`) };
  } else {
    source = publicGitTree(owner, repo, run);
  }
  const commit = source.commit;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Missing source commit');
  const tree = source.tree;
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
