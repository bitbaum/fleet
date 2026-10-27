import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredPackageUpdate, immutableGitArtifact } from './preferred-package-update.mjs';
import { repositoriesForCurrency, currencySnapshot, githubJson } from './currency-snapshot.mjs';
const sha = 'a'.repeat(40), sourceSha = 'b'.repeat(40);
const target = { name: '@bitbaum/design-tokens', repo: 'https://github.com/bitbaum/design-tokens', version: '1.2.0', release: { source: 'git', commit: sha } };
const input = { repo: 'app', path: 'desktop/template/package.json', name: '@fleet/tokens', from: 'npm:@bitbaum/design-tokens@^1.1.0', identity: { packageName: target.name, range: '^1.1.0' }, currentVersion: '1.1.0', target, sourceSha };
test('npm alias adopts newer verified Git artifact and preserves key + source lease', () => {
  const row = preferredPackageUpdate(input);
  assert.equal(row.name, '@fleet/tokens');
  assert.equal(row.to, `github:bitbaum/design-tokens#${sha}`);
  assert.equal(row.sourceSha, sourceSha);
});
test('installed newer/equal artifacts never migrate backwards to older Git', () => {
  for (const currentVersion of ['1.2.0', '1.3.0', '2.0.0', '1.3.0-beta.1', 'unresolved'])
    assert.equal(preferredPackageUpdate({ ...input, currentVersion }), null);
});
test('same-version Git pins advance to the exact verified release commit', () => {
  const old = 'c'.repeat(40);
  const row = preferredPackageUpdate({
    ...input,
    from: `github:bitbaum/design-tokens#${old}`,
    identity: { packageName: target.name },
    currentVersion: '1.2.0',
  });
  assert.equal(row.to, `github:bitbaum/design-tokens#${sha}`);
  assert.equal(row.latest, '1.2.0');
  assert.equal(preferredPackageUpdate({
    ...input,
    from: `github:bitbaum/design-tokens#${sha}`,
    identity: { packageName: target.name },
    currentVersion: '1.2.0',
  }), null);
  assert.equal(preferredPackageUpdate({
    ...input,
    from: 'npm:@bitbaum/design-tokens@^1.2.0',
    identity: { packageName: target.name, range: '^1.2.0' },
    currentVersion: '1.2.0',
  }), null);
});
test('a newer declared floor is not lowered even when old lock is behind', () => {
  assert.equal(preferredPackageUpdate({ ...input, identity: { ...input.identity, range: '^1.4.0' } }), null);
});
test('unverified Git target is rejected', () => {
  assert.throws(() => preferredPackageUpdate({ ...input, target: { ...target, release: { source: 'git', commit: 'main' } } }), /Unverified/);
});
test('equal npm release replaces Git with correct npm alias', () => {
  const row = preferredPackageUpdate({ ...input, from: `github:bitbaum/design-tokens#${sha}`, identity: { packageName: target.name }, currentVersion: '1.2.0', target: { ...target, release: { source: 'npm' } } });
  assert.equal(row.to, 'npm:@bitbaum/design-tokens@^1.2.0');
});
test('npm floor raises without downgrading an ahead lock', () => {
  const npm = { ...target, release: { source: 'npm' } };
  assert.equal(preferredPackageUpdate({ ...input, target: npm, currentVersion: '1.2.0' }).to, 'npm:@bitbaum/design-tokens@^1.2.0');
  assert.equal(preferredPackageUpdate({ ...input, target: npm, currentVersion: '1.3.0' }), null);
});
test('only immutable locked Git forms identify installed artifacts', () => {
  assert.deepEqual(immutableGitArtifact(`https://codeload.github.com/bitbaum/design-tokens/tar.gz/${sha}`), { repo: 'bitbaum/design-tokens', sha });
  assert.deepEqual(immutableGitArtifact(`git+https://github.com/bitbaum/design-tokens.git#${sha}`), { repo: 'bitbaum/design-tokens', sha });
  assert.equal(immutableGitArtifact('github:bitbaum/design-tokens#v1.2.0'), null);
});
test('public matrix never includes private or unknown visibility', () => {
  const repos = [{ name: 'public', private: false }, { name: 'secret', private: true }, { name: 'unknown' }, { name: 'fork', fork: true, private: false }];
  assert.deepEqual(repositoriesForCurrency(repos), ['public']);
  assert.deepEqual(repositoriesForCurrency(repos, true), ['public', 'secret', 'unknown']);
});
test('GitHub secondary-rate-limit 403 retries with bounded backoff', () => {
  let calls = 0;
  const waits = [];
  const result = githubJson('repos/bitbaum/app/commits/HEAD', {
    run: () => {
      calls++;
      if (calls === 1) {
        const error = new Error('Command failed: gh api');
        error.stderr = Buffer.from('gh: You have exceeded a secondary rate limit (HTTP 403)');
        throw error;
      }
      return JSON.stringify({ sha: sourceSha });
    },
    wait: milliseconds => waits.push(milliseconds),
  });
  assert.deepEqual(result, { sha: sourceSha });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10_000]);
});
test('permission 403 fails immediately instead of masking missing access', () => {
  let calls = 0;
  const error = new Error('Command failed: gh api');
  error.stderr = Buffer.from('gh: Resource not accessible by integration (HTTP 403)');
  assert.throws(() => githubJson('repos/bitbaum/app/contents/package.json', {
    run: () => { calls++; throw error; },
    wait: () => assert.fail('permission errors must not be retried'),
  }), /Command failed/);
  assert.equal(calls, 1);
});
function snapshotFixture({ truncated = false, missing = false, npm = false } = {}) {
  const files = {
    'desktop/template/package.json': JSON.stringify({ dependencies: { '@fleet/tokens': input.from } }),
    ...(npm ? { 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@fleet/tokens': { version: '1.1.0' } } }) } : {
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  desktop/template:\n    dependencies:\n      '@fleet/tokens':\n        specifier: npm:@bitbaum/design-tokens@^1.1.0\n        version: '@bitbaum/design-tokens@1.1.0'\n",
    }),
    'fixtures/ignored/package.json': '{}',
  };
  const requests = [];
  const request = path => {
    requests.push(path);
    if (path.endsWith('/commits/HEAD')) return { sha: sourceSha };
    if (path.includes('/git/trees/')) return { truncated, tree: Object.keys(files).filter(p => !missing || !p.endsWith('lock.yaml')).map(path => ({ path, type: 'blob' })) };
    assert.ok(path.endsWith(`?ref=${sourceSha}`), 'every file read is pinned to the source commit');
    const file = path.split('/contents/')[1].split('?ref=')[0];
    return { encoding: 'base64', content: Buffer.from(files[file]).toString('base64') };
  };
  return { request, requests, readFile: (_owner, _repo, path) => files[path] };
}
test('discovers nested template outside old known directories, reads actual workspace importer', () => {
  const fixture = snapshotFixture();
  const snapshot = currencySnapshot('bitbaum', 'app', fixture.request, fixture.readFile);
  assert.deepEqual(snapshot.paths, ['desktop/template/package.json']);
  assert.deepEqual(snapshot.artifacts(snapshot.paths[0], snapshot.manifest(snapshot.paths[0])), { [target.name]: '1.1.0' });
});
test('supports npm workspace hoisting evidence at the nearest lock root', () => {
  const fixture = snapshotFixture({ npm: true });
  const snapshot = currencySnapshot('bitbaum', 'app', fixture.request, fixture.readFile);
  assert.equal(snapshot.artifacts(snapshot.paths[0], snapshot.manifest(snapshot.paths[0]))[target.name], '1.1.0');
});
test('truncated tree cannot produce a partial update census', () => {
  const fixture = snapshotFixture({ truncated: true });
  assert.throws(() => currencySnapshot('bitbaum', 'app', fixture.request, fixture.readFile), /truncated/);
});
test('missing lockfile is unknown evidence rather than an assumed manifest version', () => {
  const fixture = snapshotFixture({ missing: true });
  const snapshot = currencySnapshot('bitbaum', 'app', fixture.request, fixture.readFile);
  assert.throws(() => snapshot.artifacts(snapshot.paths[0], snapshot.manifest(snapshot.paths[0])), /Missing supported lockfile/);
});

test('pnpm Git aliases normalize both codeload and git transport prefixes', async () => {
  const { lockedDependencies } = await import('./package-rollout-gate.mjs');
  for (const artifact of [`https://codeload.github.com/bitbaum/design-tokens/tar.gz/${sha}`, `git+https://github.com/bitbaum/design-tokens.git#${sha}`]) {
    const manifest = { dependencies: { '@fleet/tokens': `github:bitbaum/design-tokens#${sha}` } };
    const lock = `importers:\n  .:\n    dependencies:\n      '@fleet/tokens':\n        specifier: github:bitbaum/design-tokens#${sha}\n        version: '@bitbaum/design-tokens@${artifact}'\n`;
    const actual = lockedDependencies(manifest, lock)[target.name];
    assert.equal(actual, artifact);
    assert.equal(immutableGitArtifact(actual).sha, sha);
  }
});

test('actual workflow mutation rejects stale source/declarations and updates optional aliases', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const workflow = readFileSync(new URL('../../.github/workflows/internal-currency.yml', import.meta.url), 'utf8');
  const script = workflow.match(/echo "\$BUMPS" \| node -e '([\s\S]*?)^\s*'\s*$/m)?.[1];
  assert.ok(script, 'exercise the workflow mutation itself');
  const dir = mkdtempSync(join(tmpdir(), 'fleet-currency-lease-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const original = JSON.stringify({ optionalDependencies: { '@fleet/tokens': input.from } });
    const file = join(dir, 'package.json');
    writeFileSync(file, original);
    const row = { ...preferredPackageUpdate(input), path: 'package.json', sourceSha: head };
    const run = bump => spawnSync(process.execPath, ['-e', script], { cwd: dir, input: JSON.stringify([bump]), encoding: 'utf8' });
    let result = run({ ...row, sourceSha: 'c'.repeat(40) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source changed since planning/);
    assert.equal(readFileSync(file, 'utf8'), original);
    result = run({ ...row, from: '^0.1.0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stale declaration/);
    assert.equal(readFileSync(file, 'utf8'), original);
    result = run(row);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).optionalDependencies[row.name], row.to);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
