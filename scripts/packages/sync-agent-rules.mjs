#!/usr/bin/env node
/**
 * Give every code repo the current org-rules block, by pull request.
 *
 *   node scripts/packages/sync-agent-rules.mjs [--dry-run] [--only repo,repo]
 *
 * The block is templates/agent-rules.md (scripts/ci/agent-rules.mjs). For each
 * public, live, original repo with a package.json this puts the block into
 * AGENTS.md (creating AGENTS.md when there is none) and, when CLAUDE.md does
 * not exist, adds the pointer. It never rewrites an existing CLAUDE.md or any
 * line outside the markers: a long CLAUDE.md is a human's to fold into
 * AGENTS.md, and agent-files-audit.mjs keeps reporting it until they do.
 *
 * Branch `fleet/agent-rules`, one non-draft PR per repo; the repo's own CI
 * checks it and the sweep merges it. A PR that already carries the same text
 * is left alone; one a person closed without merging is not offered again for
 * the same text. Needs GH_TOKEN = FLEET_PAT.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_POINTER, ruleBlock, withBlock } from '../ci/agent-rules.mjs';

const ORG = 'bitbaum';
export const BRANCH = 'fleet/agent-rules';
export const TITLE = 'docs(agents): the org rules block, generated from bitbaum/fleet';

/** The files to write for a repo, given what it has now. Pure; null = nothing to do. */
export function plan({ agents, claude }, block = ruleBlock()) {
  const out = {};
  const nextAgents = withBlock(agents, block);
  if (nextAgents !== agents) out['AGENTS.md'] = nextAgents;
  if (claude == null) out['CLAUDE.md'] = CLAUDE_POINTER;
  return Object.keys(out).length ? out : null;
}

export const BODY = [
  'Adds the one org-rules block to `AGENTS.md` (between the `fleet:rules` markers; everything outside them is untouched)',
  'and, where there is no `CLAUDE.md`, a pointer to `AGENTS.md`. The block is generated from',
  '`bitbaum/fleet` `templates/agent-rules.md`: change a rule there and every repo gets it by pull request.',
  '',
  'No existing `CLAUDE.md` is rewritten. If this repo keeps a long one, fold what is still true into `AGENTS.md`',
  'and leave `CLAUDE.md` as the pointer; `scripts/ci/agent-files-audit.mjs` lists the repos still to do.',
  '',
  'Opened by `scripts/packages/sync-agent-rules.mjs` (`.github/workflows/agent-rules-sync.yml`); it merges itself when this repository\'s CI is green.',
].join('\n');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
const gh = (...args) => run('gh', args);
function raw(repo, path, ref) {
  try {
    return gh('api', `repos/${ORG}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, '-H', 'Accept: application/vnd.github.raw');
  } catch (e) {
    if (/404/.test(String(e.stderr))) return null;
    throw e;
  }
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(',')) : null;
  const block = ruleBlock();
  const repos = JSON.parse(gh('repo', 'list', ORG, '--limit', '200', '--no-archived', '--visibility', 'public', '--source', '--json', 'name,isFork,defaultBranchRef'))
    .filter(r => !r.isFork && (!only || only.has(r.name))).sort((a, b) => a.name.localeCompare(b.name));
  let opened = 0;
  for (const r of repos) {
    if (raw(r.name, 'package.json') == null) continue;
    const base = r.defaultBranchRef.name;
    const files = plan({ agents: raw(r.name, 'AGENTS.md'), claude: raw(r.name, 'CLAUDE.md') }, block);
    if (!files) { console.log(`✓ ${r.name} is current`); continue; }
    const pulls = JSON.parse(gh('api', `repos/${ORG}/${r.name}/pulls?state=all&per_page=30&head=${ORG}:${BRANCH}`));
    const open = pulls.find(p => p.state === 'open');
    if (open) {
      const same = Object.entries(files).every(([p, t]) => raw(r.name, p, BRANCH) === t);
      if (same) { console.log(`✓ ${r.name}: ${open.html_url} already carries it`); continue; }
    } else if (pulls.some(p => p.state === 'closed' && !p.merged_at && p.body === BODY && Date.now() - Date.parse(p.closed_at) < 30 * 864e5)) {
      console.log(`· ${r.name}: a person closed the pull request; not offered again for 30 days`);
      continue;
    }
    if (dry) { console.log(`→ ${r.name} would get ${Object.keys(files).join(', ')} (dry run)`); continue; }
    const work = mkdtempSync(join(tmpdir(), `rules-${r.name}-`));
    try {
      run('git', ['clone', '-q', '--depth', '1', '--branch', base, `https://github.com/${ORG}/${r.name}`, work]);
      const git = (...a) => run('git', ['-C', work, ...a]);
      git('checkout', '-q', '-B', BRANCH);
      for (const [p, t] of Object.entries(files)) writeFileSync(join(work, p), t);
      git('add', '--', ...Object.keys(files));
      git('-c', 'user.name=bitbaum-fleet', '-c', 'user.email=fleet@bitbaum.invalid', 'commit', '-q', '-m', TITLE);
      git('push', '-q', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    if (!open) {
      console.log(`→ ${r.name}: opened ${gh('pr', 'create', '--repo', `${ORG}/${r.name}`, '--base', base, '--head', BRANCH, '--title', TITLE, '--body', BODY).trim()}`);
    } else console.log(`→ ${r.name}: updated ${open.html_url}`);
    opened++;
  }
  console.log(`${opened} pull request(s) opened or updated.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
