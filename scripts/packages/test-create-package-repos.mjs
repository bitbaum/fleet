#!/usr/bin/env node
/**
 * Self-test for create-package-repos.mjs. No network, no gh.
 *
 * The script creates public repositories without a human looking, so the
 * assertions are about refusing: a malformed declaration, a source path that
 * escapes its repo, a package with no verify or no version — each must stop
 * the run before anything is created. And an existing repo is never a target.
 */

import { readFileSync } from 'node:fs';
import { parseDeclarations, render, standalonePackageJson, toCreate, repoExists, DEFAULT_PACKAGE_MANAGER } from './create-package-repos.mjs';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));
const throws = (fn, re, m) => { try { fn(); no(m, 'no error'); } catch (e) { re.test(e.message) ? ok(m) : no(m, e.message); } };

const decl = { name: 'searchkit', description: 'd', source: { repo: 'bitbaum/orangecat', path: 'packages/searchkit' } };
const doc = (repos) => JSON.stringify({ repos });

console.log('declarations');
eq(parseDeclarations(doc([decl])).map(d => d.name), ['searchkit'], 'a valid declaration parses');
throws(() => parseDeclarations(doc([{ ...decl, name: 'Search Kit' }])), /lower-case/, 'a name that is not a repo slug is refused');
throws(() => parseDeclarations(doc([decl, decl])), /declared twice/, 'a name declared twice is refused');
throws(() => parseDeclarations(doc([{ ...decl, source: { repo: 'orangecat', path: 'x' } }])), /owner\/repo/, 'a source without an owner is refused');
throws(() => parseDeclarations(doc([{ ...decl, source: { repo: 'bitbaum/orangecat', path: '../secrets' } }])), /inside the source repo/, 'a source path that escapes its repo is refused');
throws(() => parseDeclarations(doc([{ ...decl, description: '' }])), /description/, 'a repo without a description is refused');
// The real file must always parse: a broken register is a broken CI step.
eq(parseDeclarations(readFileSync(new URL('../../registers/package-repos.json', import.meta.url), 'utf8')).length > 0, true, 'registers/package-repos.json parses');

console.log('targets');
eq(toCreate([decl, { ...decl, name: 'newkit' }], ['searchkit']).map(d => d.name), ['newkit'], 'an existing repo is never a target');
eq(toCreate([decl], ['searchkit']), [], 'nothing to do when every repo exists');

console.log('repository existence checks');
eq(repoExists('searchkit', () => ''), true, 'a successful GitHub read means the repo exists');
eq(repoExists('searchkit', () => { throw Object.assign(new Error('gh: Not Found (HTTP 404)'), { stderr: 'gh: Not Found (HTTP 404)' }); }), false, 'an explicit 404 means the repo is missing');
throws(() => repoExists('searchkit', () => { throw Object.assign(new Error('API rate limit exceeded (HTTP 403)'), { stderr: 'API rate limit exceeded (HTTP 403)' }); }), /could not determine whether bitbaum\/searchkit exists/, 'a rate limit fails closed instead of treating the repo as missing');
let probeStdio;
repoExists('searchkit', (_cmd, _args, opts) => { probeStdio = opts?.stdio; return ''; });
eq(probeStdio?.[2], 'pipe', 'the existence probe captures stderr, where gh prints the 404');

console.log('standalone package.json');
const source = {
  name: '@bitbaum/searchkit', version: '0.2.2', type: 'module',
  repository: { type: 'git', url: 'git+https://github.com/bitbaum/orangecat.git', directory: 'packages/searchkit' },
  scripts: { verify: 'npm test' }, exports: { '.': './dist/index.js' },
};
const pkg = standalonePackageJson(source, { ...decl, devDependencies: { typescript: '^6.0.3' } });
eq(pkg.repository, { type: 'git', url: 'git+https://github.com/bitbaum/searchkit.git' }, 'repository points at the new repo, with no monorepo directory');
eq(pkg.homepage, 'https://github.com/bitbaum/searchkit#readme', 'homepage is the new repo');
eq(pkg.packageManager, DEFAULT_PACKAGE_MANAGER, 'the fleet pnpm is the default package manager');
eq(pkg.devDependencies, { typescript: '^6.0.3' }, 'declared devDependencies are added');
eq([pkg.name, pkg.version, pkg.exports], [source.name, source.version, source.exports], 'what the package says about itself is unchanged');
eq(source.repository.directory, 'packages/searchkit', 'the source object is not mutated');
throws(() => standalonePackageJson({ ...source, scripts: {} }, decl), /verify/, 'a package without its own verify is refused');
throws(() => standalonePackageJson({ ...source, version: undefined }, decl), /version/, 'a package without a version is refused');

console.log('templates');
eq(render('pnpm add github:bitbaum/{{name}}#v1', decl), 'pnpm add github:bitbaum/searchkit#v1', 'the name is filled in');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
