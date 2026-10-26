#!/usr/bin/env node
/**
 * Self-test for the package template and sync-package-template.mjs. No
 * network, no gh.
 *
 * The sync writes into repos nobody is watching, so the assertions are about
 * restraint: a file the repo has is never offered, a repo with everything
 * gets nothing, the same open pull request is not pushed twice, and a closed
 * one is not reopened for the same files. And the template itself must carry
 * every required file — release.yml above all — because a template that lost
 * one would quietly stop giving it to new repos.
 */

import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_TEMPLATE_FILES, checkTemplate, templateFiles } from './create-package-repos.mjs';
import { missingTemplateFiles, planSync, syncPullRequest, syncDeclarations, updatePullRequest } from './sync-package-template.mjs';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));
const throws = (fn, re, m) => { try { fn(); no(m, 'no error'); } catch (e) { re.test(e.message) ? ok(m) : no(m, e.message); } };

const decl = { name: 'searchkit', description: 'd', source: { repo: 'bitbaum/orangecat', path: 'packages/searchkit' } };
eq(syncDeclarations([decl], { packages: [{ repo: 'https://github.com/bitbaum/searchkit' }, { repo: 'https://github.com/bitbaum/accountkit' }, { repo: 'https://github.com/other/untrusted' }] }).map(x => x.name), ['searchkit', 'accountkit'], 'sync reaches existing registered kits, without duplicates or other owners');

console.log('the template');
const files = templateFiles(decl);
const paths = files.map(f => f.path);
eq(REQUIRED_TEMPLATE_FILES.filter(p => !paths.includes(p)), [], 'the real template carries every required file');
eq(paths.includes('.gitignore') && !paths.includes('gitignore'), true, 'gitignore lands as .gitignore');
eq(files.some(f => f.content.includes('{{name}}')), false, 'the package name is filled in everywhere');
throws(() => checkTemplate(paths.filter(p => p !== '.github/workflows/release.yml')), /release\.yml/, 'a template without release.yml is refused');

// The same refusal from disk: a copy of the template with release.yml deleted.
const copy = mkdtempSync(join(tmpdir(), 'tpl-'));
for (const f of files) {
  const rel = f.path === '.gitignore' ? 'gitignore' : f.path;
  mkdirSync(join(copy, rel, '..'), { recursive: true });
  writeFileSync(join(copy, rel), f.content);
}
rmSync(join(copy, '.github/workflows/release.yml'));
throws(() => templateFiles(decl, copy), /release\.yml/, 'templateFiles() refuses a template folder without release.yml');
rmSync(copy, { recursive: true, force: true });

console.log('release.yml says what it promises');
const release = readFileSync(new URL('../../templates/package/.github/workflows/release.yml', import.meta.url), 'utf8');
const has = (re, m) => (re.test(release) ? ok(m) : no(m));
has(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*bump:/, 'started by hand (or by Loki) with a bump input');
has(/options: \[patch, minor, major\]/, 'the bump is patch, minor or major');
has(/\n\s+version:\n/, 'an exact version can be asked for');
has(/gh run list --workflow ci\.yml --branch main --commit "\$SHA"/, "refuses unless main's CI ran on the exact commit");
has(/"\$conclusion" != "success"/, 'and that run must have succeeded');
has(/npm version "\$NEXT" --no-git-tag-version/, 'npm makes no tag or commit of its own');
has(/run: pnpm run verify/, "runs the package's own verify (which rebuilds dist/)");
has(/git commit -q -m "release v\$NEXT"/, 'commits "release vX.Y.Z"');
has(/git push --atomic origin/, 'commit and tag land together or not at all');
has(/token: \$\{\{ secrets\.FLEET_PAT \}\}/, 'pushes with FLEET_PAT, so publish.yml and CI fire');
has(/gh release create "v\$NEXT" --verify-tag --title "v\$NEXT" --generate-notes/, 'creates a GitHub release with generated notes');
has(/cancel-in-progress: false/, 'a release is never cancelled half-way');
// Inputs are free text typed by whoever started the run: they may reach a
// step only as an environment variable (or the run's display name), never
// pasted into a script.
eq(release.split('\n').filter(l => l.includes('inputs.') && !/^\s*(run-name:|[A-Z_]+: \$\{\{ inputs\.\w+ \}\}$)/.test(l)), [], 'inputs reach the shell only as environment variables');

console.log('what is missing');
const have = paths.filter(p => p !== '.github/workflows/release.yml');
eq(missingTemplateFiles(files, have).map(f => f.path), ['.github/workflows/release.yml'], 'only the file the repo lacks is offered');
eq(missingTemplateFiles(files, paths), [], 'a repo with every file gets nothing');
const ownCi = [...have.filter(p => p !== '.github/workflows/ci.yml'), '.github/workflows/ci.yml'];
eq(missingTemplateFiles(files, ownCi).some(f => f.path === '.github/workflows/ci.yml'), false, "a file the repo has in its own form is the repo's — never offered");

console.log('what to do');
const missing = missingTemplateFiles(files, have);
eq(planSync([], null), { action: 'nothing' }, 'nothing missing → nothing to do');
eq(planSync(missing, null), { action: 'open' }, 'missing and no pull request → open one');
eq(planSync(missing, { [missing[0].path]: missing[0].content }), { action: 'up-to-date' }, 'an open pull request with the same files is left alone');
eq(planSync(missing, { [missing[0].path]: 'old' }), { action: 'update' }, 'an open pull request with older content is updated');
eq(planSync(missing, null, [syncPullRequest(missing).title]), { action: 'declined' }, 'a pull request a person closed is not reopened for the same files');
eq(planSync(missing, null, ['chore: add the fleet package template files this repo is missing (other.yml)']), { action: 'open' }, 'a different set of files is a new offer');

console.log('the pull request');
const pr = syncPullRequest(missing);
eq(pr.title, 'chore: add the fleet package template files this repo is missing (release.yml)', 'the title names the files');
eq(pr.body.includes('`.github/workflows/release.yml`') && pr.body.includes('no file this repository already has is changed'), true, 'the body lists them and says nothing else changes');



console.log("bounded pull-request updates");
let updateFile;
const update = { title: "Template update", body: "First line\nLiteral `code` and $(not-a-command)" };
updatePullRequest((...args) => {
  eq(args.slice(0, 4), ["api", "--method", "PATCH", "repos/bitbaum/searchkit/pulls/7"], "PR edits use the bounded REST endpoint, not org/project GraphQL");
  updateFile = args[5];
  eq(JSON.parse(readFileSync(updateFile, "utf8")), update, "multiline PR content is preserved as JSON without shell expansion");
}, "searchkit", 7, update);
eq(existsSync(updateFile), false, "temporary PR payload is removed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
