#!/usr/bin/env node
/**
 * Does every repo's agent-file set follow the one shape?
 *
 *   agent-files-audit.mjs [--check] [--list] [--emit-baseline]
 *
 * One shape (scripts/ci/agent-rules.mjs): AGENTS.md carries the generated
 * org-rules block, CLAUDE.md is a pointer to AGENTS.md, and nothing imports a
 * personal ~/.claude file (a rule that exists only on one person's machine is
 * not a rule of the repo). Reads each repo's default branch through the API,
 * never a local checkout.
 *
 * THE BASELINE IS A RATCHET THAT CANNOT FLIP RED BY ANOTHER REPO IMPROVING.
 * `--check` fails only on a finding that is NOT in agent-files.baseline. A
 * baseline line whose finding is gone is reported as "fixed — delete the line"
 * and does not fail: the org-drift audit's fall-only ratchet went red twice on
 * 2026-10-26 because someone fixed a file in another repo.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings } from './agent-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = process.env.GH_OWNER ?? 'bitbaum';
const BASELINE = process.env.AGENT_FILES_BASELINE ?? join(HERE, 'agent-files.baseline');
const EXEMPT = join(HERE, 'agent-files.exempt');

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** Lines of a config file: `name  # why`, comments and blanks dropped. */
export function lines(text) {
  return text.split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

/** `all` minus the baselined ones. Pure. */
export function diff(found, baseline) {
  const base = new Set(baseline);
  const have = new Set(found);
  return {
    fresh: found.filter(f => !base.has(f)),
    fixed: baseline.filter(b => !have.has(b)),
  };
}

function rawFile(repo, path) {
  try {
    return gh('api', `repos/${ORG}/${repo}/contents/${path}`, '-H', 'Accept: application/vnd.github.raw');
  } catch (e) {
    if (/404/.test(String(e.stderr))) return null;
    throw e;
  }
}

/** Public, live, original repos that are code: they have a package.json. */
function repos() {
  const exempt = new Set(existsSyncRead(EXEMPT));
  const list = JSON.parse(gh('repo', 'list', ORG, '--limit', '200', '--no-archived', '--visibility', 'public', '--source', '--json', 'name,isFork'));
  return list.filter(r => !r.isFork && !exempt.has(r.name)).map(r => r.name).sort();
}
function existsSyncRead(p) {
  try { return lines(readFileSync(p, 'utf8')); } catch { return []; }
}

function hasCode(repo) {
  return rawFile(repo, 'package.json') != null;
}

function main() {
  const check = process.argv.includes('--check');
  const emit = process.argv.includes('--emit-baseline');
  const found = [];
  const names = repos();
  let inspected = 0;
  for (const repo of names) {
    if (!hasCode(repo)) continue;
    inspected++;
    const files = { agents: rawFile(repo, 'AGENTS.md'), claude: rawFile(repo, 'CLAUDE.md'), dotClaude: rawFile(repo, '.claude/CLAUDE.md') };
    for (const rule of findings(files)) found.push(`${repo}/${rule}`);
  }
  if (emit) { console.log(found.join('\n')); return; }
  const baseline = existsSyncRead(BASELINE);
  // A block that is merely out of date is the sync's job (it opens the pull
  // request); it is shown, never a failure, so editing the rules cannot turn
  // this red in every repo at once.
  const stale = found.filter(f => f.endsWith('/stale-rules-block'));
  const { fresh, fixed } = diff(found.filter(f => !stale.includes(f)), baseline);
  if (stale.length) console.log(`· ${stale.length} repo(s) carry an out-of-date block; the sync opens their pull requests: ${stale.map(f => f.split('/')[0]).join(', ')}`);
  console.log(`inspected ${inspected} repositories; ${found.length} agent-file finding(s), ${baseline.length} baselined.`);
  if (process.argv.includes('--list')) for (const f of found) console.log(`  ${baseline.includes(f) ? '·' : '✗'} ${f}`);
  if (fixed.length) {
    console.log('✓ baselined and now fixed — delete these lines from agent-files.baseline (not a failure):');
    for (const f of fixed) console.log(`  ${f}`);
  }
  if (fresh.length) {
    console.log('✗ new agent-file findings (fix the file, or the sync will):');
    for (const f of fresh) console.log(`  ${f}`);
    if (check) process.exit(1);
  } else console.log('✓ no new agent-file findings.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
