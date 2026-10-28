#!/usr/bin/env node
/** Self-test for the pure part of sync-agent-rules.mjs. No network. */
import { plan } from './sync-agent-rules.mjs';
import { CLAUDE_POINTER, ruleBlock, withBlock } from '../ci/agent-rules.mjs';
let pass = 0, fail = 0;
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? (console.log(`  ✓ ${m}`), pass++) : (console.log(`  ✗ ${m} — got ${JSON.stringify(a)}`), fail++));
const block = ruleBlock('Rule.\n');
eq(plan({ agents: null, claude: null }, block), { 'AGENTS.md': `# Agents\n\n${block}`, 'CLAUDE.md': CLAUDE_POINTER }, 'a repo with neither file gets both');
eq(plan({ agents: '# A\n\nmine\n', claude: 'a very long essay\n'.repeat(100) }, block), { 'AGENTS.md': `# A\n\n${block}\nmine\n` }, 'an existing CLAUDE.md is never rewritten; AGENTS.md keeps its notes');
eq(plan({ agents: withBlock('# A\n', block), claude: CLAUDE_POINTER }, block), null, 'a current repo needs nothing');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
