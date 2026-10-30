#!/usr/bin/env node
/**
 * Self-test for create-app-repos.mjs. No network, no gh.
 *
 * The script creates repositories without a human looking, so the assertions
 * are about refusing: a malformed name, an unstated visibility, a missing
 * description, a name that is already a package repo. And a repo is created
 * empty, with exactly the visibility it declares.
 */

import { readFileSync } from 'node:fs';
import { createArgs, parseDeclarations } from './create-app-repos.mjs';

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
eq(createArgs(decl), ['repo', 'create', 'bitbaum/signin', '--public', '--description', 'd'], 'a public repo is created empty: no --source, no --add-readme');
eq(createArgs({ ...decl, visibility: 'private' })[3], '--private', 'a private declaration creates a private repo');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
