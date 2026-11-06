#!/usr/bin/env node
/** Self-test for rename-package.mjs. No network. */
import { addReleaseAgeExclusions, rewrite } from './rename-package.mjs';
let pass = 0, fail = 0;
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? (console.log(`  ✓ ${m}`), pass++) : (console.log(`  ✗ ${m} — got ${JSON.stringify(a)}`), fail++));

eq(rewrite('a.ts', `import { x } from 'bip-kit';\nimport y from "bip-kit/react/mermaid";\nimport 'bip-kit/styles.css';`),
  `import { x } from '@bitbaum/bip-kit';\nimport y from "@bitbaum/bip-kit/react/mermaid";\nimport '@bitbaum/bip-kit/styles.css';`, 'quoted specifiers and subpaths are renamed');
eq(rewrite('a.ts', `// bip-kit renders it; see \`limitkit\` docs`), null, 'prose, including backticked names in comments, is left alone');
eq(rewrite('a.ts', `import '@bitbaum/bip-kit';`), null, 'an already scoped name is not touched twice');
eq(rewrite('a.ts', `const key = "bip-kit.voter";`), null, 'a string that only starts with the name is not a specifier');
eq(rewrite('next.config.ts', 'transpilePackages: [\'threadkit\', "ai-forms"]'), 'transpilePackages: [\'@bitbaum/threadkit\', "@bitbaum/ai-forms"]', 'config arrays are renamed');
eq(rewrite('pnpm-lock.yaml', `'bip-kit'`), null, 'lockfiles are never edited');
eq(rewrite('CHANGELOG.md', `"bip-kit"`), null, 'changelogs are history');
eq(rewrite('README.md', `Install "bip-kit" and \`limitkit\``), null, 'markdown is prose and is left alone');
eq(rewrite('AGENTS.md', '(or `bip-kit`, `limitkit`)'), null, 'the generated rules block is not edited');
eq(rewrite('pnpm-workspace.yaml', "- 'limitkit'"), null, 'the workspace file is handled only by the release-age step');
eq(rewrite('logo.png', `"bip-kit"`), null, 'binary-ish files are skipped');

const pkg = JSON.stringify({ name: 'app', dependencies: { 'bip-kit': '^0.6.1', react: '19' }, devDependencies: { x: 'npm:ai-forms@^0.1.3' } }, null, 2) + '\n';
const out = JSON.parse(rewrite('package.json', pkg));
eq(out.dependencies, { '@bitbaum/bip-kit': '^0.6.1', react: '19' }, 'dependency keys move, ranges stay');
eq(out.devDependencies.x, 'npm:@bitbaum/ai-forms@^0.1.3', 'npm: aliases point at the new name');
eq(rewrite('package.json', JSON.stringify({ dependencies: { react: '19' } })), null, 'a package.json without them is untouched');
eq(rewrite('package-plan.json', `{"package": "limitkit"}`), `{"package": "@bitbaum/limitkit"}`, 'plan entries are renamed');

const yaml = `allowBuilds:\n  esbuild: true\nminimumReleaseAgeExclude:\n  - 'x@1'\n`;
eq(addReleaseAgeExclusions(yaml, { '@bitbaum/limitkit': '0.2.1' }), `allowBuilds:\n  esbuild: true\nminimumReleaseAgeExclude:\n  - '@bitbaum/limitkit@0.2.1'\n  - 'x@1'\n`, 'a release-age exclusion is added for the new name');
eq(addReleaseAgeExclusions(`allowBuilds:\n  a: true\n`, { '@bitbaum/limitkit': '0.2.1' }), null, 'no exclusion list, no change');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
