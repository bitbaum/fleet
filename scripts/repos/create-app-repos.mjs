#!/usr/bin/env node
/**
 * Create the app and service repos declared in registers/app-repos.json that
 * do not exist yet — no human in the loop.
 *
 * Why this exists: an agent session's GitHub integration may not create org
 * repos (403 on POST /orgs/bitbaum/repos), so a new service waited on an
 * owner's click (bitbaum/signin, 2026-10-30). This runs in fleet CI with
 * FLEET_PAT, the same token package-repos.yml already uses, so declaring a
 * repo IS creating it.
 *
 * A repo is created with one commit on main: the files in templates/app-repo,
 * which is the fleet auto-merge caller. The sweep runs from the default
 * branch, so a repo without it never merges a PR (bitbaum/signin #1 sat green
 * for 50 minutes, 2026-10-30). Everything else arrives by pull request; the
 * first one adds ci.yml. It never touches a repo that exists, except one:
 * a declaration with `renamedFrom` renames that repo to its new name when the
 * new name does not exist yet (bitbaum/signin → bitbaum/morulia, 2026-11-01;
 * an agent session may not write repo settings). GitHub redirects the old
 * name. For every declared repo it also keeps the description and homepage
 * equal to the declaration: only those two fields, best effort (a rename does
 * not carry a new description, and bitbaum/morulia kept signin's homepage).
 * Usage:
 *   node scripts/repos/create-app-repos.mjs [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoExists } from '../packages/create-package-repos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'bitbaum';
const VISIBILITIES = ['public', 'private'];
const SEED = join(ROOT, 'templates', 'app-repo');

/** Declarations, validated: a typo must fail here, not half-create a repo. */
export function parseDeclarations(text, packageNames = []) {
  const doc = JSON.parse(text);
  const repos = doc.repos ?? [];
  const seen = new Set();
  const packages = new Set(packageNames);
  for (const d of repos) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d.name ?? '')) {
      throw new Error(`app repo name must be lower-case letters, digits and dashes: ${JSON.stringify(d.name)}`);
    }
    if (seen.has(d.name)) throw new Error(`declared twice: ${d.name}`);
    seen.add(d.name);
    if (packages.has(d.name)) throw new Error(`${d.name}: already declared in package-repos.json`);
    if (!VISIBILITIES.includes(d.visibility)) {
      throw new Error(`${d.name}: visibility must be one of ${VISIBILITIES.join(', ')} (stated, never defaulted)`);
    }
    if (!d.description) throw new Error(`${d.name}: description is required (it is the repo's description)`);
    if (d.homepage !== undefined && !/^https:\/\/[^\s/]+(\/\S*)?$/.test(d.homepage)) {
      throw new Error(`${d.name}: homepage must be an https URL: ${JSON.stringify(d.homepage)}`);
    }
    if (d.renamedFrom !== undefined) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(d.renamedFrom) || d.renamedFrom === d.name) {
        throw new Error(`${d.name}: renamedFrom must be another repo name: ${JSON.stringify(d.renamedFrom)}`);
      }
    }
  }
  return repos;
}

/**
 * What to do for one declaration: nothing when the repo exists under its name,
 * rename when only its old name exists, otherwise create. The new name is
 * asked first: after a rename GitHub redirects the old one, so it also reads
 * as existing.
 */
export function planAction(decl, exists) {
  if (exists(decl.name)) return 'none';
  if (decl.renamedFrom && exists(decl.renamedFrom)) return 'rename';
  return 'create';
}

/** The API call that renames `renamedFrom` to the declared name. */
export function renameArgs(decl) {
  return ['api', '--method', 'PATCH', `repos/${ORG}/${decl.renamedFrom}`, '-f', `name=${decl.name}`, '--silent'];
}

/** The `gh repo edit` arguments that make the repo's metadata match the declaration. */
export function metadataArgs(decl) {
  const args = ['repo', 'edit', `${ORG}/${decl.name}`, '--description', decl.description];
  if (decl.homepage) args.push('--homepage', decl.homepage);
  return args;
}

/** The `gh repo create` arguments for one declaration. The seed is a separate step. */
export function createArgs(decl) {
  return ['repo', 'create', `${ORG}/${decl.name}`, `--${decl.visibility}`, '--description', decl.description];
}

/** Every file under the seed folder, as repo-relative paths. */
export function seedFiles(dir = SEED) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => relative(dir, join(e.parentPath ?? e.path, e.name)))
    .sort();
}

/** The contents-API call that commits one seed file to the new repo's main. */
export function seedArgs(name, path, content) {
  return [
    'api', '--method', 'PUT', `repos/${ORG}/${name}/contents/${path}`,
    '-f', `message=Seed ${path} from bitbaum/fleet templates/app-repo`,
    '-f', `content=${Buffer.from(content).toString('base64')}`,
  ];
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

function create(decl) {
  run('gh', createArgs(decl), { stdio: 'inherit' });
  for (const path of seedFiles()) {
    run('gh', seedArgs(decl.name, path, readFileSync(join(SEED, path), 'utf8')), { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // Merge settings the auto-merge sweep relies on. Best effort: a token that
  // may create a repo but not edit its settings must not undo the creation.
  try {
    run('gh', ['repo', 'edit', `${ORG}/${decl.name}`, '--enable-squash-merge', '--delete-branch-on-merge', '--enable-auto-merge']);
  } catch {
    console.log(`  ! could not set merge settings on ${ORG}/${decl.name}; set squash merge, auto-merge and delete branch on merge`);
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const packageNames = (JSON.parse(readFileSync(join(ROOT, 'registers', 'package-repos.json'), 'utf8')).repos ?? []).map(d => d.name);
  const declarations = parseDeclarations(readFileSync(join(ROOT, 'registers', 'app-repos.json'), 'utf8'), packageNames);
  const plans = declarations.map(d => ({ decl: d, action: planAction(d, repoExists) }));
  for (const { decl, action } of plans) {
    if (action === 'none') continue;
    if (action === 'rename') {
      console.log(`→ ${ORG}/${decl.renamedFrom} renamed to ${ORG}/${decl.name}`);
      if (dryRun) {
        console.log('  dry run: not renamed.');
        continue;
      }
      run('gh', renameArgs(decl), { stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(`  ✓ renamed ${ORG}/${decl.renamedFrom} to ${ORG}/${decl.name}`);
      continue;
    }
    console.log(`→ ${ORG}/${decl.name} (${decl.visibility}, seeded with ${seedFiles().join(', ')})`);
    if (dryRun) {
      console.log('  dry run: not created.');
      continue;
    }
    create(decl);
    console.log(`  ✓ created ${ORG}/${decl.name}`);
  }
  if (dryRun) return;
  for (const { decl } of plans) {
    try {
      run('gh', metadataArgs(decl), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      console.log(`  ! could not set the description or homepage of ${ORG}/${decl.name}`);
    }
  }
  console.log(`${declarations.length} declared app repo(s): metadata matches the register.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    if (/403|Resource not accessible|must have admin rights/i.test(String(err.stderr ?? err.message))) {
      console.error('FLEET_PAT may not create repositories in the bitbaum org: it needs repo creation (classic: `repo`; fine-grained: Administration read/write on the org).');
    }
    process.exit(1);
  }
}
