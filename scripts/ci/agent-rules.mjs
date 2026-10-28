/**
 * The one org-rules block every repo's AGENTS.md carries, and the rules an
 * agent-file set is judged by. Pure: no network, no filesystem except reading
 * the block's source, so it is testable.
 *
 * Why: the org rules were restated by hand in CLAUDE.md essays, AGENTS.md
 * intros and starter templates, each a little different (a 1,850-line
 * CLAUDE.md, a starter that said "accounts are this app's own" above a rule
 * saying accountkit owns them). The block lives in templates/agent-rules.md
 * and nowhere else; a repo's AGENTS.md carries a generated copy between two
 * markers, and CLAUDE.md is a pointer to AGENTS.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEGIN = '<!-- fleet:rules:begin — generated from bitbaum/fleet templates/agent-rules.md; edit it there, not here -->';
export const END = '<!-- fleet:rules:end -->';
export const CLAUDE_POINTER =
  'Read [AGENTS.md](AGENTS.md). It points at `bitbaum/fleet` `AGENTS.md`, which\nevery agent reads; nothing here restates either.\n';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The block, markers included, ending in a newline. */
export function ruleBlock(body = readFileSync(join(ROOT, 'templates', 'agent-rules.md'), 'utf8')) {
  return `${BEGIN}\n\n${body.trim()}\n\n${END}\n`;
}

const MARKED = /<!-- fleet:rules:begin[^>]*-->[\s\S]*?<!-- fleet:rules:end -->\n?/;

/** The block inside a file, or null. */
export function blockIn(text) {
  const m = MARKED.exec(text ?? '');
  return m ? m[0] : null;
}

/**
 * `text` with the current block in it: replaced where the markers are, else
 * inserted under the first heading (or at the top when there is none). Idempotent.
 */
export function withBlock(text, block = ruleBlock()) {
  if (!text || !text.trim()) return `# Agents\n\n${block}`;
  if (MARKED.test(text)) return text.replace(MARKED, () => block);
  const lines = text.split('\n');
  // A heading inside another tool's marked region (create-next-app writes
  // `<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END:… -->`, which it rewrites)
  // is not this file's title: the block never goes inside such a region.
  let region = null;
  const h1 = lines.findIndex(l => {
    const open = l.match(/^<!-- BEGIN:([\w-]+) -->/);
    if (open) region = open[1];
    const hit = region === null && /^# /.test(l);
    if (region !== null && l.startsWith(`<!-- END:${region} -->`)) region = null;
    return hit;
  });
  if (h1 === -1) return `${block}\n${text}`;
  const head = lines.slice(0, h1 + 1).join('\n');
  const rest = lines.slice(h1 + 1).join('\n').replace(/^\n+/, '');
  return `${head}\n\n${block}\n${rest}`;
}

/** A CLAUDE.md that only points at AGENTS.md: short, and it names it. */
export function isPointer(claude) {
  const lines = claude.split('\n').filter(l => l.trim());
  return lines.length <= 6 && /AGENTS\.md/.test(claude);
}

/**
 * Findings for one repo's agent files. `files` = { agents, claude, dotClaude }
 * (strings, or null when the file does not exist). Each finding is a rule id.
 */
export function findings(files, block = ruleBlock()) {
  const out = [];
  const { agents, claude, dotClaude } = files;
  if (agents == null) out.push('no-agents-md');
  else {
    const have = blockIn(agents);
    if (!have) out.push('no-rules-block');
    else if (have.trim() !== block.trim()) out.push('stale-rules-block');
  }
  if (claude != null && !isPointer(claude)) out.push('claude-md-not-a-pointer');
  for (const [name, text] of [['agents', agents], ['claude', claude], ['dot-claude', dotClaude]]) {
    if (text && /~\/\.claude\b/.test(text)) out.push(`home-claude-import-in-${name}`);
  }
  return out;
}
