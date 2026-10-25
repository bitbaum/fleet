#!/usr/bin/env node
/**
 * Give every existing package repo the templates/package files it is missing,
 * by pull request — never by overwriting.
 *
 * Why this exists: create-package-repos.mjs renders templates/package once, at
 * creation, and never touches a repo again. So a file added to the template
 * later — release.yml, which is how a package's owner ships a version from
 * Loki — reached no repo that already existed. Hand-copying it is the drift
 * this fleet keeps measuring (SHARED.md), so the template is the producer and
 * this script carries it.
 *
 * For each repo declared in registers/package-repos.json that exists:
 *   1. read the file paths on its default branch (one tree read),
 *   2. pick the template files that are NOT there — a file the repo has, in
 *      any form, is the repo's and is never rewritten,
 *   3. if any are missing, put exactly those on the branch
 *      `fleet/template-sync` and open a non-draft pull request (the repo's own
 *      CI checks it; its auto-merge ships it when green). An open pull request
 *      that already carries the same files is left alone, so a daily run does
 *      not push the same change again; one a person closed unmerged is not
 *      offered again for the same files.
 *
 * Idempotent: a repo with every template file gets nothing; running twice
 * changes nothing the second time. Usage:
 *   node scripts/packages/sync-package-template.mjs [--dry-run]
 *
 * Needs GH_TOKEN = FLEET_PAT with `workflow` scope: the missing files are
 * mostly under .github/workflows, and GitHub refuses a push that adds a
 * workflow from a token without it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeclarations, templateFiles } from './create-package-repos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORG = 'bitbaum';
export const SYNC_BRANCH = 'fleet/template-sync';

/** Newly extracted packages and established kits both need release plumbing. */
export function syncDeclarations(declarations, registry) {
  const entries = new Map(declarations.map((entry) => [entry.name, entry]));
  for (const entry of registry.packages ?? []) {
    const match = /^https:\/\/github\.com\/bitbaum\/([a-z0-9-]+)$/.exec(entry.repo ?? '');
    if (match && !entries.has(match[1])) entries.set(match[1], { name: match[1] });
  }
  return [...entries.values()];
}

/** The template files a repo does not have. `repoPaths` = every path on its default branch. */
export function missingTemplateFiles(files, repoPaths) {
  const have = new Set(repoPaths);
  return files.filter(f => !have.has(f.path));
}

/** Pull request title and body for the files being added. Pure. */
export function syncPullRequest(missing) {
  const names = missing.map(f => f.path);
  const short = names.map(n => n.split('/').pop());
  return {
    title: `chore: add the fleet package template files this repo is missing (${short.join(', ')})`,
    body: [
      'Files from bitbaum/fleet `templates/package` that this repository does not have yet:',
      '',
      ...names.map(n => `- \`${n}\``),
      '',
      'Only missing files are added — no file this repository already has is changed. ' +
        '`release.yml` is what lets the package owner release a new version from Loki ' +
        '(the package page: "Release vX.Y.Z"), or from the Actions tab.',
      '',
      'Opened by bitbaum/fleet `scripts/packages/sync-package-template.mjs` ' +
        '(`.github/workflows/package-repos.yml`). It merges itself when this repository\'s CI is green.',
    ].join('\n'),
  };
}

/**
 * What to do for one repo, given what it has and any sync pull request.
 * `branchFiles` = the content of each missing path on the open sync pull
 * request's branch (null when there is none open). `declinedTitles` = titles
 * of sync pull requests a person closed without merging: the same set of
 * files is not offered again (that would reopen a "no" every day), but a
 * template file added since makes a new set and a new offer.
 */
export function planSync(missing, branchFiles, declinedTitles = []) {
  if (missing.length === 0) return { action: 'nothing' };
  if (!branchFiles && declinedTitles.includes(syncPullRequest(missing).title)) {
    return { action: 'declined' };
  }
  if (branchFiles) {
    const same = missing.every(f => branchFiles[f.path] === f.content);
    return same ? { action: 'up-to-date' } : { action: 'update' };
  }
  return { action: 'open' };
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const gh = (...args) => run('gh', args);

function repoInfo(name) {
  try {
    return JSON.parse(gh('api', `repos/${ORG}/${name}`));
  } catch {
    return null; // not created yet: create-package-repos.mjs's job, not this one's
  }
}

function repoPaths(name, branch) {
  const tree = JSON.parse(gh('api', `repos/${ORG}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`));
  if (tree.truncated) throw new Error(`${name}: the file tree is too large to read in one request`);
  return tree.tree.filter(e => e.type === 'blob').map(e => e.path);
}

function syncPulls(name) {
  const pulls = JSON.parse(gh('api', `repos/${ORG}/${name}/pulls?state=all&per_page=30&head=${ORG}:${SYNC_BRANCH}`));
  return {
    open: pulls.find(p => p.state === 'open') ?? null,
    declinedTitles: pulls.filter(p => p.state === 'closed' && !p.merged_at).map(p => p.title),
  };
}

function branchContent(name, path) {
  try {
    return gh('api', `repos/${ORG}/${name}/contents/${path}?ref=${encodeURIComponent(SYNC_BRANCH)}`, '-H', 'Accept: application/vnd.github.raw');
  } catch {
    return null;
  }
}

function pushBranch(name, defaultBranch, missing, pr) {
  const work = mkdtempSync(join(tmpdir(), `sync-${name}-`));
  run('git', ['clone', '-q', '--depth', '1', '--branch', defaultBranch, `https://github.com/${ORG}/${name}`, work]);
  const git = (...args) => run('git', ['-C', work, ...args]);
  git('checkout', '-q', '-B', SYNC_BRANCH);
  for (const f of missing) {
    mkdirSync(dirname(join(work, f.path)), { recursive: true });
    writeFileSync(join(work, f.path), f.content);
  }
  git('add', '--', ...missing.map(f => f.path));
  git('-c', 'user.name=bitbaum-fleet', '-c', 'user.email=fleet@bitbaum.invalid', 'commit', '-q', '-m', `${pr.title}\n\n${pr.body}`);
  git('push', '-q', '--force', 'origin', `HEAD:refs/heads/${SYNC_BRANCH}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const declarations = syncDeclarations(
    parseDeclarations(readFileSync(join(ROOT, 'registers', 'package-repos.json'), 'utf8')),
    JSON.parse(readFileSync(join(ROOT, 'registers', 'packages.json'), 'utf8')),
  );
  let changed = 0;
  for (const decl of declarations) {
    const info = repoInfo(decl.name);
    if (!info) {
      console.log(`· ${ORG}/${decl.name} does not exist yet — skipped`);
      continue;
    }
    const missing = missingTemplateFiles(templateFiles(decl), repoPaths(decl.name, info.default_branch));
    const pulls = missing.length ? syncPulls(decl.name) : { open: null, declinedTitles: [] };
    const pull = pulls.open;
    const branchFiles = pull ? Object.fromEntries(missing.map(f => [f.path, branchContent(decl.name, f.path)])) : null;
    const plan = planSync(missing, branchFiles, pulls.declinedTitles);
    const what = missing.map(f => f.path).join(', ');
    if (plan.action === 'nothing') {
      console.log(`✓ ${ORG}/${decl.name} has every template file`);
      continue;
    }
    if (plan.action === 'declined') {
      console.log(`· ${ORG}/${decl.name}: a person closed the pull request adding ${what}; not offered again`);
      continue;
    }
    if (plan.action === 'up-to-date') {
      console.log(`✓ ${ORG}/${decl.name}: ${pull.html_url} already adds ${what}`);
      continue;
    }
    if (dryRun) {
      console.log(`→ ${ORG}/${decl.name} would get ${what} (dry run)`);
      continue;
    }
    const pr = syncPullRequest(missing);
    pushBranch(decl.name, info.default_branch, missing, pr);
    if (plan.action === 'open') {
      const url = gh('pr', 'create', '--repo', `${ORG}/${decl.name}`, '--base', info.default_branch, '--head', SYNC_BRANCH, '--title', pr.title, '--body', pr.body).trim();
      console.log(`→ ${ORG}/${decl.name}: opened ${url} adding ${what}`);
    } else {
      gh('pr', 'edit', String(pull.number), '--repo', `${ORG}/${decl.name}`, '--title', pr.title, '--body', pr.body);
      console.log(`→ ${ORG}/${decl.name}: updated ${pull.html_url} to add ${what}`);
    }
    changed++;
  }
  console.log(`${changed} pull request(s) opened or updated.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`::error::${err.message}`);
    if (/refusing to allow|workflow/i.test(String(err.stderr ?? err.message))) {
      console.error('FLEET_PAT may not push workflow files: it needs the `workflow` scope (fine-grained: Workflows read/write).');
    }
    process.exit(1);
  });
}
