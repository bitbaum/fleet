#!/usr/bin/env node
// Fleet audit: does a repository's documentation describe the repository?
//
//   docs-truth-audit.mjs --dir DIR [--ref REF]      judge a working tree (or REF in it)
//   docs-truth-audit.mjs --repo NAME [--ref SHA]    judge a repo in the org at a commit
//   docs-truth-audit.mjs --repo NAME --pr N         only what PR N ADDS (head minus base)
//   docs-truth-audit.mjs --sweep [--check] [--emit-baseline]
//                                                   every non-archived repo, ratcheted
//
// WHY
//
// Agents read README.md, CLAUDE.md, AGENTS.md and .claude/ before they read
// code, and they act on what those files say. On 2026-10-19 one pass over nine
// repos found, in the agent-read files alone: a merge policy said to live in a
// repository that no longer holds it, eleven paths to files that had been
// deleted or never existed, scripts that are not in package.json, "Next 15 /
// TypeScript 5.8 / Tailwind 3.3" in a repo on 16 / 6 / 4, and a retired host
// presented as production in forty files. Every one of them was a claim a
// machine could have checked, and every one cost the next session time.
//
// org-drift-audit.sh already holds docs to the ORG register (names, hosts,
// legal status). Nothing held a doc to its OWN repository. This does, and only
// for claims that are mechanical:
//
//   path     a `backticked/repo/path` whose first segment exists in the repo,
//            but which itself does not
//   file     a `backticked-file.ext` (a config-shaped name) that exists nowhere
//            in the repo
//   link     a relative markdown link that resolves to nothing
//   script   `pnpm run X` / `npm run X` where X is not a script in the nearest
//            package.json (or the root one)
//   stack    "Next.js 15", "React 18", "TypeScript 5", "Tailwind 3" where
//            package.json declares a different major
//   retired  a form registers/retired.json has retired (host, name, repo,
//            account), with what to say instead
//
// It never judges prose. A line that says the thing is gone — "deleted",
// "removed", "retired", "there is no", "redirects", "formerly" … — is a line
// ABOUT history, and every check skips it. That is also the way out when a
// finding is wrong: say on the line that the thing no longer exists, which is
// what a reader needs to know anyway.
//
// WHAT IS READ
//
//   README / CLAUDE / AGENTS / CONTRIBUTING / SECURITY / REVIEW / ROADMAP .md
//   anywhere in the tree, everything under .claude/ and docs/, as markdown.
//   Never: CHANGELOG, archive/history/handoffs/sessions directories, files
//   whose name carries a date (a dated record describes its date), content/
//   (published writing), templates/ (placeholders by design), vendored code.
//
// WHERE IT RUNS
//
//   * In the auto-merge sweep, on the PR about to merge (--pr): a PR may not
//     ADD a finding — including by deleting a file a doc still names. The
//     sweep is the one workflow every repo already calls, so this needs no
//     per-repo copy and reaches every caller the day it lands.
//   * Daily from this repo (--sweep --check): the count per repo may fall or
//     hold, never rise. docs-truth.baseline is that count.
//
// Exit codes: 0 clean / no regression, 1 findings / regression, 2 could not
// look. "Could not look" is never reported as "nothing to see".
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ORG = process.env.ORG ?? "bitbaum";
const RETIRED_PATH = process.env.RETIRED ?? join(here, "../../registers/retired.json");
const BASELINE_PATH = process.env.BASELINE ?? join(here, "docs-truth.baseline");

// ------------------------------------------------------------- pure helpers

const DOC_NAMES = /(^|\/)(README|CLAUDE|AGENTS|CONTRIBUTING|SECURITY|REVIEW|ROADMAP)\.md$/i;
const SKIP_DIRS = /(^|\/)(node_modules|vendor|\.next|dist|build|out|coverage|\.git|archive|archived|history|handoffs|sessions|worktrees|proofs|content|templates|fixtures|__fixtures__|\.changeset)(\/|$)/i;
const DATED = /(^|[^\d])20\d\d-[01]\d([^\d]|$)/;

/** Which files are documentation this audit holds to the tree. */
export function isJudgedDoc(path) {
  if (!path.endsWith(".md")) return false;
  if (SKIP_DIRS.test(path)) return false;
  if (/(^|\/)CHANGELOG\.md$/i.test(path)) return false;
  if (DATED.test(posix.basename(path))) return false;
  if (DOC_NAMES.test(path)) return true;
  return path.startsWith(".claude/") || path.startsWith("docs/");
}

/** A line about history. Every check skips it. */
export const HISTORICAL = new RegExp(
  "\\b(retired|retire[sd]?|deprecated|formerly|previously|renamed|rename[sd]?|" +
    "redirect(s|ed|ing)?|no longer|used to|deleted|removed|replaced|superseded|" +
    "legacy|historical|was called|there is no|there are no|does not exist|" +
    "never existed|not yet|planned|will be|moved (to|from|out)|old (name|host|path|address)|" +
    "dropped|instead of|not\\b[^.]*\\byet)\\b",
  "i",
);

/** Strip fenced code blocks' markers but keep their lines: commands in a fence
 *  are claims too ("pnpm run verify"), paths in a fence are not (they are
 *  usually illustrative trees or sample code), so callers get both views. */
export function scanLines(text) {
  const out = [];
  let fence = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    out.push({ n: i + 1, line, fence });
  }
  return out;
}

const PATH_RE = /^[\w.@()[\]+~-]+(\/[\w.@()[\]*+~{},-]+)+\/?$/;
// Config-shaped names only: a bare "watch.sh" may be a script on the box, but
// a ".eslintrc.json" or "vitest.config.ts" is a claim about THIS repo's setup.
const FILE_RE = /^(\.[\w-]+rc(\.[\w]+)?|\.[\w-]+\.(json|ya?ml)|[\w-]+\.config\.(ts|mts|js|mjs|cjs)|tsconfig(\.[\w-]+)?\.json|docker-compose(\.[\w-]+)?\.ya?ml)$/;

/** Normalise one backticked token to a repo-relative path candidate, or null. */
export function pathCandidate(raw) {
  let t = raw.trim().replace(/[.,;:)]+$/, "").replace(/:\d+(-\d+)?$/, "").replace(/#.*$/, "");
  if (!t || /\s|\$|<|>|\.\.\.|…|=|\\|^@|^\/|^~|^\w+:\/\//.test(t)) return null;
  if (t.startsWith("./")) t = t.slice(2);
  if (!PATH_RE.test(t)) return null;
  // Only a token that LOOKS like a file (an extension on its last segment) or
  // says it is a directory (a trailing slash) is a path claim. "image/x-icon",
  // "white/NN", "next/link" and "SECOND/MINUTE/HOUR" are not.
  const last = t.replace(/\/$/, "").split("/").pop();
  if (!t.endsWith("/") && !/\.[A-Za-z][\w-]{0,9}$/.test(last)) return null;
  return t.replace(/\/$/, "");
}

/** Does `p` (possibly a glob, possibly a directory) exist in the tree set? */
export function existsIn(tree, dirs, p) {
  if (tree.has(p) || dirs.has(p)) return true;
  if (/[*{]/.test(p)) {
    const prefix = p.split(/[*{]/)[0].replace(/\/[^/]*$/, "");
    return dirs.has(prefix) || [...tree].some((f) => f.startsWith(prefix + "/"));
  }
  // a route-group or dynamic segment written loosely, e.g. app/(app)/x vs app/x
  return false;
}

export function dirsOf(tree) {
  const dirs = new Set();
  for (const f of tree) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

/** Major version a package.json declares for `name`, or null if not a semver. */
export function declaredMajor(pkg, name) {
  for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
    const v = pkg?.[k]?.[name];
    if (typeof v !== "string") continue;
    const m = v.replace(/^npm:[^@]+@/, "").match(/^[\^~>=<\s]*v?(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

const STACK = [
  { pkg: "next", re: /\bNext(?:\.js)?\s+v?(\d{2})(?![\d.]*\s*(?:ms|px|%))\b/g, label: "Next.js" },
  { pkg: "react", re: /\bReact\s+v?(\d{2})\b/g, label: "React" },
  { pkg: "typescript", re: /\bTypeScript\s+v?(\d)(?:\.\d+)?(?:\.x)?\b/g, label: "TypeScript" },
  { pkg: "tailwindcss", re: /\bTailwind(?:\s+CSS)?\s+v?(\d)(?:\.\d+)?(?:\.x)?\b/g, label: "Tailwind CSS" },
];

// Used when the org's repo list cannot be read: a line naming a sibling repo
// is describing that repo's tree, not this one's.
export const FALLBACK_REPOS = ["orangecat", "loki", "solon", "fleet", "dotfiles", "evig", "heidi", "substrata", "bitbaum", "causius", "diplodoctor", "hirnli", "botsmann", "datacat", "petvity", "kivvi", "sitekit", "chatkit", "searchkit", "accountkit", "whenkit", "listkit", "design-tokens", "aoz-begleitung"];
// First segments that are always this repo's own, even when a change has just
// removed the last file under them (that removal is the drift to catch).
const KNOWN_ROOTS = new Set(["src", "app", "lib", "scripts", "docs", "components", "packages", "public", "supabase", "drizzle", ".github", ".claude", "tests", "__tests__", "e2e", "config", "hooks", "messages"]);
const ILLUSTRATIVE = /\b(e\.g\.|i\.e\.|for example|for instance|example:|such as|placeholder|would (go|live|be))/i;
const CODE_ROOTS = ["src", "app", "apps", "packages", "lib"];
const GENERATED = /^(\.claude\/worktrees|\.tmp|tmp|\.next|node_modules|dist|build|out|coverage|\.env|\.turbo|\.vercel|test-results|playwright-report)(\/|$)/;
const OTHER_REPO = /\bbitbaum\/[\w.-]+|github\.com\/|\b(in|from|of) (the )?(fleet|orangecat|loki|solon|dotfiles|evig|heidi|substrata|bitbaum)(\b| repo)/i;

/** A deliberately small .gitignore reader: enough to know that a doc naming
 *  public/widget.js (built, never committed) is not naming a missing file. */
export function gitignoreMatcher(text) {
  const rules = (text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
  const res = rules.map((r) => {
    const anchored = r.startsWith("/");
    const body = r.replace(/^\//, "").replace(/\/$/, "");
    const rx = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".");
    return new RegExp(anchored || body.includes("/") ? `^${rx}(/|$)` : `(^|/)${rx}(/|$)`);
  });
  return (p) => res.some((r) => r.test(p));
}

const SCRIPT_RE = /\b(?:pnpm|npm|yarn|bun)((?:\s+--?[\w-]+(?:[= ][^\s`]+)?)*)\s+run\s+([\w:.@/-]+)/g;

/** The retired register as [{from, to, since}] — forms specific enough to grep. */
export function parseRetired(json) {
  try {
    return (JSON.parse(json).retired ?? []).filter((r) => r.from && r.from.length >= 5);
  } catch { return []; }
}

/**
 * The judgement, isolated from the network so it can be tested.
 * repo:  { name, tree: Set<string>, read(path) -> string|null }
 */
export function judgeRepo({ name, tree, read }, retired = [], otherRepos = FALLBACK_REPOS) {
  const others = otherRepos.filter((r) => r !== name && r.length >= 4).map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const otherRepo = others.length ? new RegExp(`\\b(${others.join("|")})\\b`, "i") : null;
  const dirs = dirsOf(tree);
  const top = new Set([...tree, ...dirs].map((p) => p.split("/")[0]));
  const basenames = new Set([...tree].map((f) => posix.basename(f)));
  const ignore = gitignoreMatcher(tree.has(".gitignore") ? read(".gitignore") : "");
  const ignored = (p) => GENERATED.test(p) || ignore(p);
  const exts = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".md", ".json", "/index.ts", "/index.tsx", "/index.js", "/route.ts", "/page.tsx"];
  // `lib/x.ts` in an app whose code is under src/ means src/lib/x.ts; a doc in
  // docs/ may name a sibling; and "Composer" may be written without ".tsx".
  const resolves = (p, docDir) => {
    const bases = [p, docDir ? posix.normalize(posix.join(docDir, p)) : null, ...CODE_ROOTS.map((r) => `${r}/${p}`)].filter(Boolean);
    return bases.some((b) => exts.some((e) => existsIn(tree, dirs, b + e)));
  };
  const pkgCache = new Map();
  const pkgAt = (dir) => {
    if (pkgCache.has(dir)) return pkgCache.get(dir);
    const p = dir ? `${dir}/package.json` : "package.json";
    let v = null;
    if (tree.has(p)) { try { v = JSON.parse(read(p) ?? ""); } catch { v = null; } }
    pkgCache.set(dir, v);
    return v;
  };
  const nearestPkgs = (doc) => {
    const out = [];
    let d = posix.dirname(doc);
    while (true) {
      const dd = d === "." ? "" : d;
      const p = pkgAt(dd);
      if (p) out.push(p);
      if (!dd) break;
      d = posix.dirname(d);
    }
    return out;
  };
  const rootPkg = pkgAt("");
  const findings = [];
  const add = (file, n, kind, token, detail) => findings.push({ repo: name, file, line: n, kind, token, detail });

  for (const file of [...tree].filter(isJudgedDoc).sort()) {
    const text = read(file);
    if (text == null) continue;
    const docDir = posix.dirname(file) === "." ? "" : posix.dirname(file);
    const pkgs = nearestPkgs(file);
    const scripts = new Set(pkgs.flatMap((p) => Object.keys(p.scripts ?? {})));

    // A file that describes OTHER repositories by design (a global agent file
    // installed into ~/.claude from dotfiles) opts its paths out, on the
    // record: `<!-- docs-truth: paths-elsewhere -->`. Retired names still count.
    const elsewhere = /<!--\s*docs-truth:\s*paths-elsewhere\b[^>]*-->/.test(text);
    const rows = scanLines(text);
    let para = "";
    for (let i = 0; i < rows.length; i++) {
      const { n, line, fence } = rows[i];
      // The paragraph (or list item) so far: a wrapped sentence names its
      // repository once, often lines before the path it then quotes.
      if (!line.trim() || /^(\s{0,1}[-*+] |\s{0,1}\d+\. |#)/.test(line)) para = "";
      para += " " + line;
      // Judge the PROSE for history words, not the names it quotes: a file
      // called removed.ts is not a sentence about something being removed.
      // A name kept ON PURPOSE (a JWT issuer, a cookie key) is a decision, not
      // drift: `<!-- docs-truth: keep — why -->` on the line records it.
      if (/<!--\s*docs-truth:\s*keep\b/.test(line)) continue;
      const prose = (l) => (l ?? "").replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]");
      // A sentence wrapped across lines says "removed" once; read on to its
      // end (up to two more lines) before deciding it is a claim.
      let sentence = prose(line);
      for (let k = 1; k <= 2 && !fence && !/[.!?:]\s*$/.test(rows[i + k - 1]?.line ?? ".") && rows[i + k] && !rows[i + k].fence && rows[i + k].n === n + k && rows[i + k].line.trim(); k++) {
        sentence += " " + prose(rows[i + k].line);
      }
      if (HISTORICAL.test(sentence)) continue;

      // --- retired forms
      for (const r of retired) {
        if (line.includes(r.from)) {
          add(file, n, "retired", r.from, `uses retired "${r.from}" — say "${r.to}" (since ${r.since ?? "?"})`);
        }
      }

      // --- scripts (also inside fences: a command block is a claim)
      if (pkgs.length && !elsewhere) {
        for (const m of line.matchAll(SCRIPT_RE)) {
          // `cd examples/next && pnpm run dev` runs THAT package's script.
          const cd = [...line.slice(0, m.index).matchAll(/\bcd\s+([\w./-]+)/g)].pop();
          if (cd) {
            const raw = cd[1].replace(/\/$/, "");
            const cand = [raw, raw.split("/").slice(1).join("/"), docDir ? posix.join(docDir, raw) : ""].filter(Boolean).map((d) => posix.normalize(d));
            const p = cand.map((d) => pkgAt(d)).find(Boolean);
            if (p) { if (p.scripts?.[m[2]]) continue; }
            else continue; // a directory this repo does not hold: not ours to judge
          }
          const flags = m[1] ?? "";
          if (/--filter|(^|\s)-F(\s|=)|(^|\s)-C(\s|=)|--dir|--prefix|--workspace|(^|\s)-w(\s|$)/.test(flags)) continue;
          const s = m[2].replace(/[.,;:)]+$/, "");
          if (!s || s.includes("<") || scripts.has(s)) continue;
          add(file, n, "script", s, `\`${m[0].trim()}\` — no "${s}" script in package.json`);
        }
      }

      // --- stack majors (prose only; fences are samples)
      if (!fence && rootPkg) {
        for (const { pkg, re, label } of STACK) {
          const want = declaredMajor(rootPkg, pkg);
          if (want == null) continue;
          for (const m of line.matchAll(re)) {
            const got = Number(m[1]);
            if (got !== want) add(file, n, "stack", `${label} ${got}`, `says ${label} ${got}; package.json declares ${pkg} ${want}`);
          }
        }
      }

      if (fence || elsewhere) continue; // trees and code samples are illustrations, not claims

      // --- relative markdown links
      // A link shown INSIDE a code span is an example of markup, not a link.
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        let target = m[1].replace(/^<|>$/g, "");
        if (/^(\w+:|#|\/\/)/.test(target) || /[{}$]/.test(target)) continue;
        // "/thoughts/x" is a route on the site, not a file in the repo.
        if (target.startsWith("/") && !/\.[A-Za-z]\w{0,9}$/.test(target.replace(/[#?].*$/, ""))) continue;
        target = decodeURIComponent(target.replace(/[#?].*$/, ""));
        if (!target) continue;
        const resolved = target.startsWith("/")
          ? posix.normalize(target.slice(1))
          : posix.normalize(posix.join(docDir, target));
        if (resolved.startsWith("..")) continue; // points outside the repo
        // "/thoughts/x.svg" on a Next site is public/thoughts/x.svg.
        const r = resolved.replace(/\/$/, "");
        if (!existsIn(tree, dirs, r) && !(target.startsWith("/") && existsIn(tree, dirs, `public/${r}`))) {
          add(file, n, "link", target, `links to ${target}, which is not in the repo`);
        }
      }

      // --- backticked paths and config-shaped file names
      // A line that names another repository ("lives in bitbaum/fleet,
      // scripts/ci/…") is describing THAT tree; this one cannot judge it.
      const ctx = para;
      if (OTHER_REPO.test(ctx) || (otherRepo && otherRepo.test(ctx))) continue;
      // "e.g. public/art/condor-dream.jpg" is where a file WOULD go.
      if (ILLUSTRATIVE.test(prose(line))) continue;
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const raw = m[1];
        const p = pathCandidate(raw);
        if (p) {
          if (ignored(p)) continue;
          const first = p.split("/")[0];
          if (docDir && posix.normalize(posix.join(docDir, p)).startsWith("..")) continue; // outside this repo
          const rel = p.startsWith("../") || (docDir && dirs.has(posix.join(docDir, first)));
          if (!top.has(first) && !KNOWN_ROOTS.has(first) && !rel && !CODE_ROOTS.some((r) => dirs.has(posix.join(r, first)))) continue;
          if (resolves(p, docDir)) continue;
          add(file, n, "path", p, `names \`${p}\`, which is not in the repo`);
          continue;
        }
        const f = raw.trim().replace(/[.,;:)]+$/, "");
        if (FILE_RE.test(f) && !basenames.has(f) && !ignored(f)) {
          add(file, n, "file", f, `names \`${f}\`, which exists nowhere in the repo`);
        }
      }
    }
  }
  return findings;
}

/** Findings in `head` whose key is not in `base` — what a change ADDS. */
export function added(base, head) {
  const k = (f) => `${f.file}|${f.kind}|${f.token}`;
  const seen = new Map();
  for (const f of base) seen.set(k(f), (seen.get(k(f)) ?? 0) + 1);
  const out = [];
  for (const f of head) {
    const c = seen.get(k(f)) ?? 0;
    if (c > 0) seen.set(k(f), c - 1);
    else out.push(f);
  }
  return out;
}

/** baseline: `repo count` per line. */
export function parseBaseline(text) {
  const m = new Map();
  for (const line of (text ?? "").split("\n")) {
    const t = line.replace(/#.*/, "").trim();
    if (!t) continue;
    const [repo, count] = t.split(/\s+/);
    if (repo && /^\d+$/.test(count ?? "")) m.set(repo, Number(count));
  }
  return m;
}

export function regressions(counts, baseline) {
  const out = [];
  for (const [repo, n] of counts) {
    const allowed = baseline.get(repo) ?? 0;
    if (n > allowed) out.push({ repo, n, allowed });
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo));
}

export function formatFindings(findings) {
  return findings.map((f) => `  ${f.repo}/${f.file}:${f.line}  [${f.kind}] ${f.detail}`).join("\n");
}

// ------------------------------------------------------------- I/O

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** A repo at a ref, without its large blobs: trees + every file under 512 KB. */
function fetchRepo(name, refs) {
  const dir = mkdtempSync(join(tmpdir(), "docs-truth-"));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const url = token
    ? `https://x-access-token:${token}@github.com/${ORG}/${name}.git`
    : `https://github.com/${ORG}/${name}.git`;
  sh("git", ["init", "-q", dir]);
  sh("git", ["-C", dir, "fetch", "-q", "--depth=1", "--filter=blob:limit=524288", url, ...refs]);
  return dir;
}

function repoAt(dir, ref, name) {
  const list = sh("git", ["-C", dir, "ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean);
  return {
    name,
    tree: new Set(list),
    read(p) {
      try { return sh("git", ["-C", dir, "show", `${ref}:${p}`]); } catch { return null; }
    },
  };
}

/** The working tree as an agent sees it: tracked plus new, unignored files. */
function workTree(dir, name) {
  const list = sh("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter(Boolean)
    .filter((p) => existsSync(join(dir, p)));
  return { name, tree: new Set(list), read(p) { try { return readFileSync(join(dir, p), "utf8"); } catch { return null; } } };
}

function retiredList() {
  return existsSync(RETIRED_PATH) ? parseRetired(readFileSync(RETIRED_PATH, "utf8")) : [];
}

function gh(args) {
  return JSON.parse(sh("gh", args));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

let orgRepoNames = null;
function repoNames() {
  if (orgRepoNames) return orgRepoNames;
  try { orgRepoNames = gh(["api", "--paginate", `orgs/${ORG}/repos?per_page=100&type=all`]).map((r) => r.name); }
  catch { orgRepoNames = FALLBACK_REPOS; }
  return orgRepoNames;
}

function main() {
  const retired = retiredList();
  const json = process.argv.includes("--json");
  try {
    if (arg("--dir")) {
      const d = arg("--dir");
      const name = posix.basename(sh("git", ["-C", d, "rev-parse", "--show-toplevel"]).trim());
      const ref = arg("--ref");
      const f = judgeRepo(ref ? repoAt(d, ref, name) : workTree(d, name), retired, repoNames());
      if (json) writeFileSync(1, JSON.stringify(f, null, 1));
      else console.log(f.length ? `✗ ${f.length} finding(s)\n${formatFindings(f)}` : `✓ ${name}: docs agree with the tree`);
      process.exit(f.length ? 1 : 0);
    }

    if (arg("--repo") && arg("--pr")) {
      const name = arg("--repo").split("/").pop();
      const pr = gh(["api", `repos/${ORG}/${name}/pulls/${arg("--pr")}`]);
      const base = pr.base.sha, head = pr.head.sha;
      const dir = fetchRepo(name, [base, head]);
      try {
        const neu = added(judgeRepo(repoAt(dir, base, name), retired, repoNames()), judgeRepo(repoAt(dir, head, name), retired, repoNames()));
        if (json) writeFileSync(1, JSON.stringify(neu, null, 1));
        else console.log(neu.length ? `✗ PR #${arg("--pr")} adds ${neu.length} docs finding(s)\n${formatFindings(neu)}` : `✓ PR #${arg("--pr")} adds no docs drift`);
        process.exit(neu.length ? 1 : 0);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    if (arg("--repo")) {
      const name = arg("--repo").split("/").pop();
      const ref = arg("--ref") ?? gh(["api", `repos/${ORG}/${name}`]).default_branch;
      const dir = fetchRepo(name, [ref]);
      try {
        const f = judgeRepo(repoAt(dir, "FETCH_HEAD", name), retired, repoNames());
        if (json) writeFileSync(1, JSON.stringify(f, null, 1));
        else console.log(f.length ? `✗ ${f.length} finding(s)\n${formatFindings(f)}` : `✓ ${name}: docs agree with the tree`);
        process.exit(f.length ? 1 : 0);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    if (process.argv.includes("--sweep")) {
      // --repos FILE: a JSON listing to use instead of the API (same fields),
      // for a session whose gh cannot authenticate but whose git can fetch.
      const listing = arg("--repos")
        ? JSON.parse(readFileSync(arg("--repos"), "utf8"))
        : gh(["api", "--paginate", `orgs/${ORG}/repos?per_page=100&type=all`]);
      orgRepoNames = listing.map((r) => r.name);
      const repos = listing
        .filter((r) => !r.archived && !r.fork && !r.disabled && r.size !== 0)
        .map((r) => ({ name: r.name, branch: r.default_branch ?? "HEAD" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const counts = new Map();
      const all = [];
      const unreadable = [];
      for (const r of repos) {
        let dir;
        try {
          dir = fetchRepo(r.name, [r.branch]);
          const f = judgeRepo(repoAt(dir, "FETCH_HEAD", r.name), retired, orgRepoNames);
          counts.set(r.name, f.length);
          all.push(...f);
        } catch (e) {
          unreadable.push(r.name);
        } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
      }
      if (unreadable.length) console.log(`⚠ could not read: ${unreadable.join(", ")}`);
      const total = all.length;
      console.log(`${repos.length} repos, ${total} docs finding(s)`);
      for (const [repo, n] of [...counts].filter(([, n]) => n).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${repo}`);
      if (process.argv.includes("--list") || process.argv.includes("--verbose")) console.log(formatFindings(all));
      if (json) writeFileSync(arg("--json") ?? "docs-truth.json", JSON.stringify(all, null, 1));
      if (process.argv.includes("--emit-baseline")) {
        const body = [...counts].filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join("\n");
        writeFileSync(BASELINE_PATH, `# docs-truth: findings per repo. May fall or hold, never rise.\n# GENERATED by docs-truth-audit.mjs --sweep --emit-baseline\n${body}${body ? "\n" : ""}`);
        console.log(`wrote ${BASELINE_PATH}`);
      }
      if (process.argv.includes("--check")) {
        if (unreadable.length === repos.length) { console.error("could not read any repo"); process.exit(2); }
        const reg = regressions(counts, parseBaseline(existsSync(BASELINE_PATH) ? readFileSync(BASELINE_PATH, "utf8") : ""));
        if (reg.length) {
          console.log(`✗ docs drift rose:\n${reg.map((r) => `  ${r.repo}: ${r.n} (baseline ${r.allowed})`).join("\n")}`);
          console.log(formatFindings(all.filter((f) => reg.some((r) => r.repo === f.repo))));
          process.exit(1);
        }
        console.log("✓ no repo has more docs drift than its baseline");
      }
      process.exit(0);
    }
  } catch (e) {
    console.error(`could not look: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }
  console.error("usage: docs-truth-audit.mjs --dir DIR | --repo NAME [--ref SHA | --pr N] | --sweep [--check] [--emit-baseline] [--list]");
  process.exit(2);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
