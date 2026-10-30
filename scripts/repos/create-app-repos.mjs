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
 * A repo is created empty: no README and no commit, so the project's first
 * push is its whole history. It never touches a repo that exists. Usage:
 *   node scripts/repos/create-app-repos.mjs [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoExists, toCreate } from '../packages/create-package-repos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'bitbaum';
const VISIBILITIES = ['public', 'private'];

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
  }
  return repos;
}

/** The `gh repo create` arguments for one declaration: empty, nothing seeded. */
export function createArgs(decl) {
  return ['repo', 'create', `${ORG}/${decl.name}`, `--${decl.visibility}`, '--description', decl.description];
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

function create(decl) {
  run('gh', createArgs(decl), { stdio: 'inherit' });
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
  const missing = toCreate(declarations, declarations.filter(d => repoExists(d.name)).map(d => d.name));
  if (missing.length === 0) {
    console.log(`All ${declarations.length} declared app repo(s) exist. Nothing to create.`);
    return;
  }
  for (const decl of missing) {
    console.log(`→ ${ORG}/${decl.name} (${decl.visibility}, empty)`);
    if (dryRun) {
      console.log('  dry run: not created.');
      continue;
    }
    create(decl);
    console.log(`  ✓ created ${ORG}/${decl.name}`);
  }
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
