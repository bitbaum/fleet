#!/usr/bin/env node
/** Self-test for agent-rules.mjs. No network. */
import { BEGIN, END, CLAUDE_POINTER, ruleBlock, blockIn, withBlock, isPointer, findings } from './agent-rules.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = m => { console.log(`  ✓ ${m}`); pass++; };
const no = (m, got) => { console.log(`  ✗ ${m}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, a));

const block = ruleBlock('Rule one.\n');
console.log('inserting the block');
eq(withBlock('', block), `# Agents\n\n${block}`, 'an empty file becomes a heading and the block');
const doc = '# Agents\n\nOnly this repo.\n';
const once = withBlock(doc, block);
eq(once, `# Agents\n\n${block}\nOnly this repo.\n`, 'the block goes under the first heading, repo notes keep their place');
eq(withBlock(once, block), once, 'applying it twice changes nothing');
eq(withBlock('no heading here\n', block), `${block}\nno heading here\n`, 'a file without a heading gets the block on top');
const foreign = '<!-- BEGIN:nextjs-agent-rules -->\n# This is NOT the Next.js you know\n\nBody.\n<!-- END:nextjs-agent-rules -->\n';
eq(withBlock(foreign, block), `${block}\n${foreign}`, 'a heading inside another tool\'s marked region is not the title: the block goes on top, never inside it');
eq(withBlock(`${foreign}\n# Title\n\nNotes.\n`, block), `${foreign}\n# Title\n\n${block}\nNotes.\n`, '…and the first heading outside such a region still takes it');
const newer = ruleBlock('Rule two.\n');
eq(blockIn(withBlock(once, newer)), newer, 'a changed block replaces the old one in place');
eq(withBlock(once, newer).includes('Rule one.'), false, '…and nothing of the old one is left');
eq(withBlock(once, newer).includes('Only this repo.'), true, '…and the repo notes survive');
ok(BEGIN.startsWith('<!-- fleet:rules:begin') && END.includes('fleet:rules:end') ? 'markers are a pair' : 'x');

console.log('the shipped block');
const real = ruleBlock();
for (const phrase of ['@bitbaum/chatkit', '@bitbaum/searchkit', '@bitbaum/chartkit', '@bitbaum/accountkit', 'auto-merge sweep', 'No model identifier']) {
  real.includes(phrase) ? ok(`names ${phrase}`) : no(`names ${phrase}`);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const t of ['templates/app/AGENTS.md', 'templates/package/AGENTS.md', 'templates/AGENTS.md']) {
  const text = readFileSync(join(root, t), 'utf8');
  blockIn(text)?.trim() === real.trim() ? ok(`${t} carries the current block`) : no(`${t} carries the current block`);
}
for (const t of ['templates/app/CLAUDE.md', 'templates/package/CLAUDE.md']) {
  isPointer(readFileSync(join(root, t), 'utf8')) ? ok(`${t} is a pointer`) : no(`${t} is a pointer`);
}

console.log('findings');
eq(findings({ agents: once, claude: CLAUDE_POINTER, dotClaude: null }, block), [], 'a clean repo has none');
eq(findings({ agents: null, claude: null, dotClaude: null }, block), ['no-agents-md'], 'no AGENTS.md is a finding');
eq(findings({ agents: doc, claude: null, dotClaude: null }, block), ['no-rules-block'], 'AGENTS.md without the block');
eq(findings({ agents: withBlock(doc, newer), claude: null, dotClaude: null }, block), ['stale-rules-block'], 'an out-of-date block');
eq(findings({ agents: once, claude: 'x\n'.repeat(40), dotClaude: null }, block), ['claude-md-not-a-pointer'], 'a long CLAUDE.md is not a pointer');
eq(findings({ agents: once, claude: '@~/.claude/CLAUDE.md\nRead AGENTS.md\n', dotClaude: null }, block), ['home-claude-import-in-claude'], 'a personal-home import is a finding');
eq(isPointer('Read [AGENTS.md](AGENTS.md).\n'), true, 'a one-line pointer is a pointer');
eq(isPointer('Be nice.\n'), false, 'a short file that does not name AGENTS.md is not');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
