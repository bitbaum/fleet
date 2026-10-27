#!/usr/bin/env node
/**
 * Create the package repos declared in registers/package-repos.json that do
 * not exist yet — no human in the loop.
 *
 * Why this exists: a package that lives in a folder of another repo cannot be
 * installed by tag, so Dependabot cannot move it forward and every consumer
 * stays pinned to a commit somebody has to bump by hand (searchkit, 2026-10-12:
 * five repos, five hand-written lockfile edits per release). Creating its own
 * repo used to need an owner's click, because an agent session's GitHub
 * integration may not create org repos. This runs in fleet CI with FLEET_PAT,
 * the org's cross-repo token, so declaring a package IS creating it.
 *
 * For each declared package whose repo is missing:
 *   1. copy the source folder from the source repo's default branch,
 *   2. make its package.json standalone (repository, packageManager, the
 *      devDependencies the declaration names),
 *   3. add templates/package (CI, auto-merge, publish, release, dependabot,
 *      licence),
 *   4. install, and run the package's own `verify` — nothing is created from
 *      a tree that does not pass,
 *   5. create bitbaum/<name>, push main, tag v<version>.
 *
 * It never touches a repo that exists: changes after creation go through that
 * repo's own pull requests. Usage:
 *   node scripts/packages/create-package-repos.mjs [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'bitbaum';
export const DEFAULT_PACKAGE_MANAGER = 'pnpm@11.25.0';

/** Declarations, validated: a typo must fail here, not half-create a repo. */
export function parseDeclarations(text) {
  const doc = JSON.parse(text);
  const repos = doc.repos ?? [];
  const seen = new Set();
  for (const d of repos) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d.name ?? '')) {
      throw new Error(`package repo name must be lower-case letters, digits and dashes: ${JSON.stringify(d.name)}`);
    }
    if (seen.has(d.name)) throw new Error(`declared twice: ${d.name}`);
    seen.add(d.name);
    if (!/^[\w.-]+\/[\w.-]+$/.test(d.source?.repo ?? '')) throw new Error(`${d.name}: source.repo must be owner/repo`);
    if (!d.source?.path || d.source.path.includes('..') || d.source.path.startsWith('/')) {
      throw new Error(`${d.name}: source.path must be a folder inside the source repo`);
    }
    if (!d.description) throw new Error(`${d.name}: description is required (it is the repo's description)`);
  }
  return repos;
}

/** Which declared repos are missing, given the names that exist. */
export function toCreate(declarations, existing) {
  const have = new Set(existing);
  return declarations.filter(d => !have.has(d.name));
}

/**
 * The source package.json, made standalone. Everything the package says about
 * itself stays; only where it lives and how it builds alone changes.
 */
export function standalonePackageJson(source, decl) {
  const pkg = structuredClone(source);
  const url = `https://github.com/${ORG}/${decl.name}`;
  pkg.repository = { type: 'git', url: `git+${url}.git` };
  pkg.homepage = `${url}#readme`;
  pkg.bugs = { url: `${url}/issues` };
  pkg.packageManager = decl.packageManager ?? DEFAULT_PACKAGE_MANAGER;
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...(decl.devDependencies ?? {}) };
  if (!pkg.scripts?.verify) {
    throw new Error(`${decl.name}: the source package.json has no "verify" script — a repo is only created from a tree that checks itself`);
  }
  if (!pkg.version) throw new Error(`${decl.name}: the source package.json has no version to tag`);
  return pkg;
}

/** templates/package text with the package's name filled in. */
export function render(text, decl) {
  return text.replaceAll('{{name}}', decl.name);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

function repoExists(name) {
  try {
    run('gh', ['api', `repos/${ORG}/${name}`, '--silent']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The files every package repo must carry, by their path in the repo. A
 * template that lost one of these would create (or sync) repos without it —
 * release.yml above all, which is how a package's owner ships a version from
 * Loki — so both scripts refuse to run from such a template.
 */
export const REQUIRED_TEMPLATE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/dependabot.yml',
  '.github/workflows/auto-merge.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  '.github/workflows/release.yml',
  '.gitignore',
  'LICENSE',
];

/** A template file's path in the repo: `gitignore` is stored without its dot so git here does not obey it. */
export function templateTarget(rel) {
  return rel === 'gitignore' ? '.gitignore' : rel;
}

/** Refuse a template that lacks a required file. `paths` are repo paths. */
export function checkTemplate(paths) {
  const have = new Set(paths);
  const missing = REQUIRED_TEMPLATE_FILES.filter(p => !have.has(p));
  if (missing.length) {
    throw new Error(`templates/package is missing ${missing.join(', ')} — every package repo needs it`);
  }
}

/** Every templates/package file, rendered for one package: [{ path, content }]. */
export function templateFiles(decl, base = join(ROOT, 'templates', 'package')) {
  const walk = dir =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
    );
  const files = walk(base)
    .map(file => ({ path: templateTarget(relative(base, file)), content: render(readFileSync(file, 'utf8'), decl) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  checkTemplate(files.map(f => f.path));
  return files;
}

function copyTemplates(dest, decl) {
  for (const file of templateFiles(decl)) {
    const out = join(dest, file.path);
    if (existsSync(out)) continue; // a file the package already has wins
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file.content);
  }
}

function seed(decl, work) {
  const src = join(work, 'src-repo');
  run('git', ['clone', '--depth', '1', `https://github.com/${decl.source.repo}`, src]);
  const sha = run('git', ['-C', src, 'rev-parse', 'HEAD']).trim();
  const from = join(src, decl.source.path);
  if (!existsSync(join(from, 'package.json'))) {
    throw new Error(`${decl.name}: ${decl.source.repo}/${decl.source.path} has no package.json`);
  }
  const pkgDir = join(work, decl.name);
  cpSync(from, pkgDir, { recursive: true });
  const pkg = standalonePackageJson(JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')), decl);
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  copyTemplates(pkgDir, decl);
  // A lockfile of its own, then the package's own gate. Nothing is created
  // from a tree that does not pass.
  run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: pkgDir, stdio: 'inherit' });
  // A package whose verify drives a browser (chartkit's label audit, chatkit's
  // layout checks) needs Chromium on the runner; pnpm install does not fetch
  // it. The template CI does the same, keyed on the same devDependency.
  if (pkg.devDependencies?.playwright) {
    run('pnpm', ['exec', 'playwright', 'install', '--with-deps', 'chromium'], { cwd: pkgDir, stdio: 'inherit' });
  }
  run('pnpm', ['run', 'verify'], { cwd: pkgDir, stdio: 'inherit' });
  return { pkgDir, pkg, sha };
}

function publish(decl, { pkgDir, pkg, sha }) {
  const git = (...args) => run('git', ['-C', pkgDir, ...args]);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git(
    '-c', 'user.name=bitbaum-fleet',
    '-c', 'user.email=fleet@bitbaum.invalid',
    'commit', '-q', '-m',
    `${pkg.name} ${pkg.version}: its own repo\n\nMoved from ${decl.source.repo} ${decl.source.path} at ${sha}; ` +
      `the history before this commit is there. Created by bitbaum/fleet ` +
      `scripts/packages/create-package-repos.mjs from registers/package-repos.json.`
  );
  git('tag', `v${pkg.version}`);
  run('gh', [
    'repo', 'create', `${ORG}/${decl.name}`, '--public',
    '--description', decl.description,
    '--source', pkgDir, '--remote', 'origin', '--push',
  ], { stdio: 'inherit' });
  git('push', '-q', 'origin', `v${pkg.version}`);
  // Merge settings the auto-merge sweep relies on. Best effort: a token that
  // may create a repo but not edit its settings must not undo the creation.
  try {
    run('gh', ['repo', 'edit', `${ORG}/${decl.name}`, '--enable-squash-merge', '--delete-branch-on-merge', '--enable-auto-merge']);
  } catch {
    console.log(`  ! could not set merge settings on ${ORG}/${decl.name}; set squash merge, auto-merge and delete branch on merge`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const declarations = parseDeclarations(readFileSync(join(ROOT, 'registers', 'package-repos.json'), 'utf8'));
  const missing = toCreate(declarations, declarations.filter(d => repoExists(d.name)).map(d => d.name));
  if (missing.length === 0) {
    console.log(`All ${declarations.length} declared package repo(s) exist. Nothing to create.`);
    return;
  }
  for (const decl of missing) {
    console.log(`→ ${ORG}/${decl.name} from ${decl.source.repo} ${decl.source.path}`);
    const work = mkdtempSync(join(tmpdir(), `pkg-${decl.name}-`));
    const seeded = seed(decl, work);
    if (dryRun) {
      console.log(`  dry run: ${seeded.pkg.name}@${seeded.pkg.version} passes its own verify; not created.`);
      continue;
    }
    publish(decl, seeded);
    console.log(`  ✓ created ${ORG}/${decl.name} and tagged v${seeded.pkg.version}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`::error::${err.message}`);
    if (/403|Resource not accessible|must have admin rights/i.test(String(err.stderr ?? err.message))) {
      console.error('FLEET_PAT may not create repositories in the bitbaum org: it needs repo creation (classic: `repo`; fine-grained: Administration read/write on the org).');
    }
    process.exit(1);
  });
}
