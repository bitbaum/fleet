#!/usr/bin/env node
/**
 * Move a consumer repo from an unscoped fleet package to its @bitbaum name.
 *
 *   node scripts/packages/rename-package.mjs <repo-dir> [--apply]
 *
 * The four packages moved in docs/package-scope-migration-plan.md. Dry run by
 * default: prints what would change. With --apply it edits the tree; it never
 * touches a lockfile (run the repo's package manager afterwards), CHANGELOGs,
 * node_modules, dist or build output.
 *
 * What changes, and only this:
 *   - package.json dependency keys (all four sections) and `npm:` alias values;
 *   - quoted specifiers in code, style and config files: 'bip-kit' or "bip-kit/react"
 *     (backticks, markdown and text are prose and stay as they are);
 *   - "package" entries in package-plan.json;
 *   - pnpm-workspace.yaml: a release-age exclusion for the new name's version,
 *     when the file already uses minimumReleaseAgeExclude.
 * Prose that mentions a package by name is left alone.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RENAMES = {
  'bip-kit': '@bitbaum/bip-kit',
  limitkit: '@bitbaum/limitkit',
  'ai-forms': '@bitbaum/ai-forms',
  threadkit: '@bitbaum/threadkit',
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.turbo', 'out']);
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'CHANGELOG.md']);
// Code, styles and config only: prose (markdown, text) and the generated AGENTS.md rules block name
// packages for people, and are not import specifiers.
// Code and styles only. JSON is data: translated copy, register snapshots and overrides keyed by the
// register's package names must not change; package.json and package-plan.json are handled by name below.
const TEXT = /\.(?:[cm]?[jt]sx?|css|html)$/;
// Derived or mirrored files are regenerated from their source, never edited by hand.
const DERIVED = /(?:\.generated\.|\.snapshot\.|(?:^|\/)site-template\/)/;
const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const names = Object.keys(RENAMES).join('|');
const SPECIFIER = new RegExp(`(["'])(${names})(/[^"'\\s]*)?\\1`, 'g');
const ALIAS = new RegExp(`^npm:(${names})@`);

/** Pure: new text for one file, or null when nothing changes. */
export function rewrite(path, text) {
  const base = path.split('/').pop();
  if (SKIP_FILES.has(base) || base === 'pnpm-workspace.yaml') return null;
  if (DERIVED.test(path)) return null;
  if (base === 'package.json') return rewritePackageJson(text);
  if (base === 'package-plan.json') return rewritePlan(text);
  if (!TEXT.test(base)) return null;
  const next = text.replace(SPECIFIER, (_all, q, name, sub = '') => `${q}${RENAMES[name]}${sub}${q}`);
  return next === text ? null : next;
}

/** A package plan names packages in `"package": "<name>"` entries; nothing else in it is a specifier. */
function rewritePlan(text) {
  const next = text.replace(new RegExp(`("package"\\s*:\\s*")(${names})(")`, 'g'), (_all, a, name, b) => `${a}${RENAMES[name]}${b}`);
  return next === text ? null : next;
}

function rewritePackageJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  let changed = false;
  for (const section of SECTIONS) {
    const deps = data[section];
    if (!deps) continue;
    const out = {};
    for (const [key, range] of Object.entries(deps)) {
      let value = range;
      const alias = typeof range === 'string' ? range.match(ALIAS) : null;
      if (alias) { value = range.replace(ALIAS, `npm:${RENAMES[alias[1]]}@`); changed = true; }
      if (RENAMES[key]) { out[RENAMES[key]] = value; changed = true; } else out[key] = value;
    }
    data[section] = out;
  }
  if (!changed) return null;
  const indent = /^\{\n( +)"/.exec(text)?.[1].length ?? 2;
  return JSON.stringify(data, null, indent) + (text.endsWith('\n') ? '\n' : '');
}

/** Pure: pnpm-workspace.yaml with release-age exclusions for the renamed packages in use. */
export function addReleaseAgeExclusions(yaml, versions) {
  if (!/^minimumReleaseAgeExclude:/m.test(yaml)) return null;
  // One scope glob already exempts every @bitbaum package; naming versions would be noise.
  if (/^\s*-\s*['"]?@bitbaum\/\*['"]?\s*$/m.test(yaml)) return null;
  let next = yaml;
  for (const [name, version] of Object.entries(versions)) {
    const entry = `${name}@${version}`;
    if (next.includes(entry)) continue;
    next = next.replace(/^minimumReleaseAgeExclude:\n/m, `minimumReleaseAgeExclude:\n  - '${entry}'\n`);
  }
  return next === yaml ? null : next;
}

/** Which unscoped names a file actually used (so only those get a release-age exclusion). */
function renamedNames(path, text) {
  const found = new Set();
  if (path.endsWith('package.json')) {
    try {
      const data = JSON.parse(text);
      for (const section of SECTIONS) for (const [key, range] of Object.entries(data[section] ?? {})) {
        if (RENAMES[key]) found.add(key);
        const alias = typeof range === 'string' ? range.match(ALIAS) : null;
        if (alias) found.add(alias[1]);
      }
    } catch { /* not JSON: nothing renamed */ }
    return found;
  }
  for (const m of text.matchAll(SPECIFIER)) found.add(m[2]);
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (stat.size < 2_000_000) yield full;
  }
}

/** Walk a repo; returns [{ file, text }] of every file that would change. */
export function plan(dir, versions = {}) {
  const changes = [];
  const used = {};
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    const next = rewrite(file, text);
    if (next !== null) {
      changes.push({ file: relative(dir, file), text: next });
      for (const name of renamedNames(file, text)) if (versions[RENAMES[name]]) used[RENAMES[name]] = versions[RENAMES[name]];
    }
  }
  const ws = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(ws) && Object.keys(used).length) {
    const next = addReleaseAgeExclusions(readFileSync(ws, 'utf8'), used);
    if (next !== null) changes.push({ file: 'pnpm-workspace.yaml', text: next });
  }
  return changes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: rename-package.mjs <repo-dir> [--apply]'); process.exit(2); }
  const versions = { '@bitbaum/bip-kit': '0.6.1', '@bitbaum/limitkit': '0.2.1', '@bitbaum/ai-forms': '0.1.3', '@bitbaum/threadkit': '0.1.1' };
  const changes = plan(dir, versions);
  for (const c of changes) {
    console.log(`${process.argv.includes('--apply') ? 'edit' : 'would edit'} ${c.file}`);
    if (process.argv.includes('--apply')) writeFileSync(join(dir, c.file), c.text);
  }
  console.log(`${changes.length} file(s)${process.argv.includes('--apply') ? ' changed; now run the repo package manager to refresh its lockfile' : ' would change (add --apply)'}`);
}
