#!/usr/bin/env node
/**
 * Self-test for create-app-repos.mjs. No network, no gh.
 *
 * The script creates repositories without a human looking, so the assertions
 * are about refusing: a malformed name, an unstated visibility, a missing
 * description, a name that is already a package repo. And a repo is created
 * with exactly the visibility it declares, seeded with the auto-merge caller
 * the sweep needs on main.
 */

import { readFileSync } from 'node:fs';
import { createArgs, parseDeclarations, seedArgs, seedFiles } from './create-app-repos.mjs';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));
const throws = (fn, re, m) => { try { fn(); no(m, 'no error'); } catch (e) { re.test(e.message) ? ok(m) : no(m, e.message); } };

const decl = { name: 'signin', visibility: 'public', description: 'd' };
const doc = (repos) => JSON.stringify({ repos });

console.log('declarations');
eq(parseDeclarations(doc([decl])).map(d => d.name), ['signin'], 'a valid declaration parses');
throws(() => parseDeclarations(doc([{ ...decl, name: 'Sign In' }])), /lower-case/, 'a name that is not a repo slug is refused');
throws(() => parseDeclarations(doc([decl, decl])), /declared twice/, 'a name declared twice is refused');
throws(() => parseDeclarations(doc([{ ...decl, visibility: undefined }])), /visibility/, 'a missing visibility is refused, not defaulted');
throws(() => parseDeclarations(doc([{ ...decl, visibility: 'internal' }])), /visibility/, 'an unknown visibility is refused');
throws(() => parseDeclarations(doc([{ ...decl, description: '' }])), /description/, 'a repo without a description is refused');
throws(() => parseDeclarations(doc([decl]), ['signin']), /package-repos/, 'a name already declared as a package repo is refused');

const real = JSON.parse(readFileSync(new URL('../../registers/package-repos.json', import.meta.url), 'utf8')).repos.map(d => d.name);
const registered = parseDeclarations(readFileSync(new URL('../../registers/app-repos.json', import.meta.url), 'utf8'), real);
ok(`the real register parses (${registered.length} repo(s))`);

console.log('creation');
eq(createArgs(decl), ['repo', 'create', 'bitbaum/signin', '--public', '--description', 'd'], 'a public repo is created with no --source and no --add-readme');
eq(createArgs({ ...decl, visibility: 'private' })[3], '--private', 'a private declaration creates a private repo');

console.log('seed');
eq(seedFiles(), ['.github/workflows/auto-merge.yml'], 'main is seeded with the auto-merge caller, and only that');
const caller = readFileSync(new URL('../../templates/app-repo/.github/workflows/auto-merge.yml', import.meta.url), 'utf8');
/uses: bitbaum\/fleet\/\.github\/workflows\/auto-merge-sweep\.yml@main/.test(caller) ? ok('the seeded caller calls the fleet sweep') : no('the seeded caller calls the fleet sweep');
!/deploy_workflow/.test(caller) ? ok('the seed names no deploy workflow a new repo does not have') : no('the seed names no deploy workflow a new repo does not have');
const put = seedArgs('signin', '.github/workflows/auto-merge.yml', 'x');
eq(put.slice(0, 4), ['api', '--method', 'PUT', 'repos/bitbaum/signin/contents/.github/workflows/auto-merge.yml'], 'a seed file is committed through the contents API');
eq(put.at(-1), 'content=' + Buffer.from('x').toString('base64'), 'its content is sent base64-encoded');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
