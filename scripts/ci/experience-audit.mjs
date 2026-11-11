#!/usr/bin/env node
/**
 * Does this product ship the fleet's experience, or its own version of it?
 *
 *   node scripts/ci/experience-audit.mjs --dir <repo> [--list] [--init]
 *
 * The owner's finding (2026-11-06): the packages are installed everywhere and
 * the screens people touch are still built per app. A text box with no
 * microphone, a header that is not the fleet's header, a comment list that
 * works its own way: for a user that is the same as having no package at all.
 * AGENTS.md "The experience belongs to the package" is the rule; this is the
 * measurement.
 *
 * It counts five kinds of file, in the product's own source, that stand where
 * a package already owns the behaviour:
 *
 *   bareTextareas       a <textarea>/<Textarea> in a file that imports neither
 *                       chatkit (mic, 16px, keyboard) nor writingkit
 *   localChrome         a Header / Navbar / TabBar / Sidebar / Footer file that
 *                       does not import sitekit
 *   localComposers      a Composer / ChatInput / CommentBox file that is not
 *                       chatkit's
 *   localComments       a Comment(s) list/thread/section file that does not
 *                       import chatkit
 *   localArticleEditors an Article/Post/Blog Composer/Editor/Form file that
 *                       does not import writingkit
 *   mutedChats          a file that renders chatkit's ChatApp/Composer with
 *                       `attach: false` or `voice: false` on a line that carries
 *                       no `experience-exempt: <reason>` comment. A chat with no
 *                       paperclip or no microphone is a chat that cannot be
 *                       used by everyone it serves. Opt-in: it only fails a
 *                       product whose ceiling names it (`"mutedChats": 0`).
 *
 * What it does with the counts is the product's choice, in package-plan.json:
 *
 *   "experience": { "ceiling": { "bareTextareas": 48, "localChrome": 12 } }
 *
 * A kind missing from the ceiling means zero. With a ceiling, a count above it
 * fails (the ratchet: it may fall, it may hold, it may not rise). Without an
 * `experience` key the audit only reports, so existing products are not
 * broken by a rule they have not yet been given a baseline for; the app
 * template ships `"ceiling": {}`, so a NEW product starts at zero.
 *
 * A file can say why it is the exception, on its own: a first-line comment
 * `// experience-exempt: <reason of at least 20 characters>` removes it from
 * the count. The reason is the review.
 *
 * It reads source text only. It cannot tell a name field from prose, which is
 * why it counts <textarea> (long text) and leaves single-line inputs alone.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = [
  'bareTextareas',
  'localChrome',
  'localComposers',
  'localComments',
  'localArticleEditors',
  'mutedChats',
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.claude',
  'dist',
  'build',
  'coverage',
  '__tests__',
  'tests',
  'test',
  'e2e',
  '.turbo',
  'storybook-static',
]);
const SOURCE = /\.(tsx|jsx)$/;
const TEST_FILE = /\.(test|spec|stories)\.(tsx|jsx)$/;

const CHROME = /^(Header|SiteHeader|Navbar|NavBar|Navigation|MainNav|MobileNav|BottomNav|TabBar|Sidebar|Footer|SiteFooter)\.(tsx|jsx)$/;
const COMPOSER = /^(Composer|ChatInput|MessageInput|CommentBox|CommentComposer|ReplyComposer)\.(tsx|jsx)$/;
const COMMENTS = /^Comments?(Section|List|Thread|Item)?\.(tsx|jsx)$/;
const ARTICLE_EDITOR = /^(Article|Post|Blog)(Composer|Editor|Form)\.(tsx|jsx)$/;

const imports = (source, pkg) =>
  new RegExp(`(?:from\\s*|import\\s*)['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^'"]*)?['"]`).test(source);

const MUTED = /\b(attach|voice)\s*(?::|=)\s*\{?\s*false\b/;
const LINE_EXEMPT = /experience-exempt:\s*\S.{19,}/;

const EXEMPT = /^\s*(?:\/\/|\/\*)\s*experience-exempt:\s*(\S.{19,})/;

/** Walk a repo's source files, skipping build output and tests. */
function* walk(dir, root = dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) yield* walk(full, root);
    else if (SOURCE.test(name) && !TEST_FILE.test(name)) yield relative(root, full);
  }
}

/** What this file counts as, if anything. Pure on (path, source). */
export function classify(path, source) {
  const name = basename(path);
  const firstLines = source.split('\n', 3).join('\n');
  if (EXEMPT.test(firstLines.replace(/^\s*['"]use (client|server)['"];?\s*\n/, ''))) return [];
  const kinds = [];
  const chatkit = imports(source, '@bitbaum/chatkit');
  const sitekit = imports(source, '@bitbaum/sitekit');
  const writingkit = imports(source, '@bitbaum/writingkit');
  if (/<(textarea|Textarea)\b/.test(source) && !chatkit && !writingkit) kinds.push('bareTextareas');
  if (CHROME.test(name) && !sitekit) kinds.push('localChrome');
  if (COMPOSER.test(name) && !chatkit) kinds.push('localComposers');
  if (COMMENTS.test(name) && !chatkit) kinds.push('localComments');
  if (ARTICLE_EDITOR.test(name) && !writingkit) kinds.push('localArticleEditors');
  if (
    chatkit &&
    /<(ChatApp|Composer)\b/.test(source) &&
    source.split('\n').some((line) => MUTED.test(line) && !LINE_EXEMPT.test(line))
  )
    kinds.push('mutedChats');
  return kinds;
}

/** { counts, files } for a repo directory. */
export function measure(dir) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const files = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const path of walk(dir)) {
    let source;
    try {
      source = readFileSync(join(dir, path), 'utf8');
    } catch {
      continue;
    }
    for (const kind of classify(path, source)) {
      counts[kind] += 1;
      files[kind].push(path);
    }
  }
  return { counts, files };
}

/** Findings against a ceiling; empty when there is none to hold the count to. */
export function overCeiling(counts, plan) {
  const ceiling = plan?.experience?.ceiling;
  if (!ceiling || typeof ceiling !== 'object') return [];
  // mutedChats is opt-in: a product that has not named it in its ceiling is not
  // failed for it (existing products have a baseline they never agreed to).
  return KINDS.filter((k) => (k !== 'mutedChats' || Number.isInteger(ceiling[k])) && counts[k] > (Number.isInteger(ceiling[k]) ? ceiling[k] : 0)).map(
    (k) =>
      `${k}: ${counts[k]} above the ceiling of ${Number.isInteger(ceiling[k]) ? ceiling[k] : 0} — use the package's component (see AGENTS.md "The experience belongs to the package"), or lower the count; do not raise the ceiling.`,
  );
}

export function readPlan(dir) {
  const file = resolve(dir, 'package-plan.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main(argv) {
  const at = argv.indexOf('--dir');
  const dir = resolve(at >= 0 ? argv[at + 1] : '.');
  const { counts, files } = measure(dir);
  const plan = readPlan(dir);
  const findings = overCeiling(counts, plan);
  const hasCeiling = !!plan?.experience?.ceiling;
  console.log(
    'experience: ' + KINDS.map((k) => `${k}=${counts[k]}`).join(' ') + (hasCeiling ? '' : '  (no ceiling set: report only)'),
  );
  if (argv.includes('--list')) {
    for (const k of KINDS) for (const f of files[k]) console.log(`  ${k}  ${f}`);
  }
  if (argv.includes('--init')) {
    console.log(JSON.stringify({ experience: { ceiling: counts } }, null, 2));
  }
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
