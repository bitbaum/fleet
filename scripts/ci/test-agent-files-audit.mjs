#!/usr/bin/env node
/** Self-test for the pure parts of agent-files-audit.mjs. No network. */
import { diff, lines } from './agent-files-audit.mjs';
let pass = 0, fail = 0;
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? (console.log(`  ✓ ${m}`), pass++) : (console.log(`  ✗ ${m} — got ${JSON.stringify(a)}`), fail++));
eq(lines('# c\n\nx/y  # why\n  z/w\n'), ['x/y', 'z/w'], 'baseline lines drop comments and blanks');
eq(diff(['a/r', 'b/r'], ['a/r']), { fresh: ['b/r'], fixed: [] }, 'a finding that is not baselined is new');
eq(diff(['a/r'], ['a/r', 'b/r']), { fresh: [], fixed: ['b/r'] }, 'a baselined finding that is gone is fixed, and is not a failure');
eq(diff([], []), { fresh: [], fixed: [] }, 'nothing found, nothing baselined');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
