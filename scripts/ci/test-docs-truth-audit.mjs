#!/usr/bin/env node
// Tests for docs-truth-audit.mjs. No network: every case is an in-memory tree.
import {
  added,
  declaredMajor,
  gitignoreMatcher,
  isJudgedDoc,
  judgeRepo,
  parseBaseline,
  parseRetired,
  pathCandidate,
  regressions,
} from "./docs-truth-audit.mjs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

function repo(files, name = "demo") {
  const tree = new Set(Object.keys(files));
  return { name, tree, read: (p) => files[p] ?? null };
}
const kinds = (fs) => fs.map((f) => `${f.kind}:${f.token}`).sort();
const PKG = JSON.stringify({
  scripts: { verify: "x", test: "x", "check:agent": "x" },
  dependencies: { next: "^16.3.8", react: "19.3.0" },
  devDependencies: { typescript: "^6.0.3", tailwindcss: "^4" },
});
const RETIRED = parseRetired(JSON.stringify({ retired: [
  { from: "revampit.orangecat.ch", to: "evig.orangecat.ch", since: "2026-09-10" },
  { from: "sink", to: "x" }, // too short to grep safely: dropped
] }));

console.log("which files are judged");
check("root and nested agent files", isJudgedDoc("README.md") && isJudgedDoc("packages/x/AGENTS.md") && isJudgedDoc(".claude/rules/a.md") && isJudgedDoc("docs/ops.md"));
check("CHANGELOG, archives, dated records, content, templates are history", ![
  "CHANGELOG.md", "docs/archive/old.md", "docs/sprint-2026-07-13-prove.md", "docs/AUDIT_2026-06.md",
  "content/posts/a.md", "templates/app/CLAUDE.md", ".claude/sessions/s.md", "node_modules/x/README.md",
].some(isJudgedDoc));
check("a random markdown file outside docs is not an agent doc", !isJudgedDoc("src/notes.md"));

console.log("path candidates");
check("a repo path with an extension", pathCandidate("src/lib/x.ts") === "src/lib/x.ts");
check("trailing slash says directory", pathCandidate("scripts/ci/") === "scripts/ci");
check("line suffix and anchor stripped", pathCandidate("src/a.ts:42") === "src/a.ts" && pathCandidate("docs/a.md#x") === "docs/a.md");
for (const t of ["image/x-icon", "white/NN", "next/link", "SECOND/MINUTE/HOUR", "@bitbaum/chatkit", "/opt/evig/app/.env", "https://x.y/a.md", "pnpm run verify", "a/b <c>"]) {
  check(`not a path: ${t}`, pathCandidate(t) === null);
}

check("a template is not a file", pathCandidate("scripts/db/migrations/NNN_descriptive_name.sql") === null && pathCandidate("src/lib/hirn/providers/[name].ts") === null && pathCandidate("migrations/YYYYMMDDHHMMSS_x.sql") === null);
check("a dynamic route segment still is", pathCandidate("src/app/[slug]/page.tsx") === "src/app/[slug]/page.tsx");

console.log("dead paths, links and files");
{
  const f = judgeRepo(repo({
    "package.json": PKG,
    "src/lib/real.ts": "",
    "src/app/page.tsx": "",
    "docs/guide.md": "",
    "CLAUDE.md": [
      "Read `src/lib/real.ts` and `src/lib/gone.ts`.",
      "Shorthand `lib/real.ts` means src/lib, so it is fine.",
      "See [the guide](docs/guide.md) and [missing](docs/missing.md).",
      "Config lives in `.eslintrc.json` and `vitest.config.ts`.",
      "`src/lib/zellij.ts` was deleted in 2026-09.",
      "Routes like [blog](/thoughts/x) are site routes.",
      "In bitbaum/fleet, `scripts/ci/auto-merge-sweep.sh` is the policy.",
      "OrangeCat keeps `src/config/ecosystem.ts`.",
      "```",
      "src/",
      "└── `src/not/a/claim.ts` in a tree",
      "```",
    ].join("\n"),
  }), [], ["orangecat", "fleet"]);
  const k = kinds(f);
  check("missing path found", k.includes("path:src/lib/gone.ts"));
  check("existing path, and src-relative shorthand, are fine", !k.includes("path:src/lib/real.ts") && !k.includes("path:lib/real.ts"));
  check("dead relative link found, live one not", k.includes("link:docs/missing.md") && !k.includes("link:docs/guide.md"));
  check("config-shaped names that exist nowhere", k.includes("file:.eslintrc.json") && k.includes("file:vitest.config.ts"));
  check("a line saying the thing is deleted is history", !k.includes("path:src/lib/zellij.ts"));
  check("a site route is not a file", !k.some((x) => x.startsWith("link:/thoughts")));
  check("a line about another repo is not judged against this one", !k.includes("path:scripts/ci/auto-merge-sweep.sh") && !k.includes("path:src/config/ecosystem.ts"));
  check("trees inside code fences are illustrations", !k.includes("path:src/not/a/claim.ts"));
  check("findings carry a line number", f.every((x) => x.line > 0));
}

console.log("a wrapped sentence keeps its repository");
{
  const f = judgeRepo(repo({
    "AGENTS.md": [
      "- What an entity is: `orangecat/src/config/entity-registry.ts` holds it,",
      "  and `__tests__/unit/config/entity-admission.test.ts` enforces it.",
      "",
      "Here `src/missing.ts` is this repo's own claim again.",
    ].join("\n"),
  }), [], ["orangecat"]);
  check("a path two lines after the repo it belongs to is not judged here", !kinds(f).includes("path:__tests__/unit/config/entity-admission.test.ts"));
  check("a new paragraph is judged again", kinds(f).includes("path:src/missing.ts"));
}

console.log("feedback from the first cleanup");
{
  const f = judgeRepo(repo({
    "package.json": PKG,
    "examples/next/package.json": JSON.stringify({ scripts: { dev: "x" } }),
    "README.md": [
      "Run `cd examples/next && pnpm run dev`, and `cd examples/next && pnpm run nope`.",
      "The worklists `docs/a.md` and `docs/b.md` were",
      "removed once the work shipped.",
      "A new painting goes in public/art, e.g. `public/art/condor.jpg`.",
    ].join("\n"),
    "GLOBAL.md": "",
  }));
  const k = kinds(f);
  check("a cd into a sub-package reads that package's scripts", !k.includes("script:dev") && k.includes("script:nope"));
  check("a removal stated on the next line is still history", !k.some((x) => x.startsWith("path:docs/")));
  check("an example path is not a claim", !k.includes("path:public/art/condor.jpg"));
}
{
  const f = judgeRepo(repo({ "CLAUDE.md": "<!-- docs-truth: paths-elsewhere -->\nProduct repos keep `app/globals.css` and `tailwind.config.ts`.\nProduction is revampit.orangecat.ch." }), RETIRED);
  check("a file that describes other repos opts its paths out, not its names", kinds(f).join() === "retired:revampit.orangecat.ch");
}

{
  const f = judgeRepo(repo({ "CLAUDE.md": "| `JWT_ISSUER` (`revampit.orangecat.ch`) | Changing it invalidates every session. | <!-- docs-truth: keep — live sessions key on it -->" }), RETIRED);
  check("a name kept on purpose, marked on its line, is a decision", f.length === 0);
}

{
  const f = judgeRepo(repo({ "public/thoughts/a.svg": "", "docs/style.md": "Embed it as ![x](/thoughts/a.svg); markup looks like `![alt](/thoughts/{name}.svg)`." }));
  check("a /file link served from public/ resolves; a link inside a code span is markup", f.length === 0);
}

console.log("relative to the doc's own directory");
{
  const f = judgeRepo(repo({
    "docs/ops/a.md": "See [b](./b.md), [up](../top.md) and [gone](./c.md).",
    "docs/ops/b.md": "",
    "docs/top.md": "",
  }));
  check("sibling and parent links resolve", kinds(f).join() === "link:./c.md");
}

console.log("scripts");
{
  const f = judgeRepo(repo({
    "package.json": PKG,
    "README.md": [
      "Run `pnpm run verify`, then `npm run check:agent`.",
      "```bash",
      "pnpm run test:changed   # not a script",
      "pnpm --filter web run build",
      "```",
      "`pnpm run analyze` is not wired yet.",
    ].join("\n"),
  }));
  const k = kinds(f);
  check("missing script found, even inside a fence", k.includes("script:test:changed"));
  check("existing scripts pass", !k.includes("script:verify") && !k.includes("script:check:agent"));
  check("a filtered workspace command is not judged against the root", !k.includes("script:build"));
  check("a line saying not yet is a plan, not a claim", !k.includes("script:analyze"));
}
{
  const f = judgeRepo(repo({
    "package.json": PKG,
    "site/package.json": JSON.stringify({ scripts: { publish: "x" } }),
    "site/README.md": "Run `pnpm run publish` and `pnpm run verify`.",
  }));
  check("nearest package.json and the root one both count", f.length === 0);
}

console.log("stack majors");
check("declaredMajor reads ranges", declaredMajor(JSON.parse(PKG), "next") === 16 && declaredMajor(JSON.parse(PKG), "tailwindcss") === 4);
check("declaredMajor ignores git deps", declaredMajor({ dependencies: { x: "github:a/b#c" } }, "x") === null);
{
  const f = judgeRepo(repo({
    "package.json": PKG,
    "AGENTS.md": [
      "Stack: Next.js 15, React 18, TypeScript 5.8, Tailwind CSS 3.3.",
      "Stack: Next.js 16, React 19, TypeScript 6.x, Tailwind 4.",
      "Tailwind v4 (this line previously claimed 3.3).",
      "### Immediate (Next 30 Days) and Short-term (next 90 days)",
    ].join("\n"),
  }));
  const k = kinds(f);
  check("each wrong major found", ["stack:Next.js 15", "stack:React 18", "stack:TypeScript 5", "stack:Tailwind CSS 3"].every((x) => k.includes(x)));
  check("right majors and history lines pass", f.length === 4);
}
{
  const f = judgeRepo(repo({ "AGENTS.md": "Next.js 15 everywhere." }));
  check("no package.json, no stack judgement", f.length === 0);
}

console.log("retired forms");
{
  const f = judgeRepo(repo({
    "README.md": [
      "Production is https://revampit.orangecat.ch.",
      "revampit.orangecat.ch redirects to evig.orangecat.ch.",
      "Built by sink.",
    ].join("\n"),
  }), RETIRED);
  check("retired host found once, with what to say instead", f.length === 1 && /evig\.orangecat\.ch/.test(f[0].detail));
}

console.log(".gitignore");
{
  const ig = gitignoreMatcher("public/widget.js\n/.tmp/\n*.log\n# c\n!keep.log\n");
  check("anchored, unanchored and glob rules", ig("public/widget.js") && ig(".tmp/x") && ig("a/b.log") && !ig("src/widget.js"));
  const f = judgeRepo(repo({ ".gitignore": "public/widget.js\n", "src/x.ts": "", "README.md": "Built into `public/widget.js` from `src/x.ts`." }));
  check("a built, ignored file is not missing", f.length === 0);
}

console.log("added — what a change introduces");
{
  const a = { file: "a.md", kind: "path", token: "x" };
  const b = { file: "a.md", kind: "path", token: "y" };
  check("only new keys", added([a], [a, b]).length === 1 && added([a], [a, b])[0].token === "y");
  check("a fix adds nothing", added([a, b], [a]).length === 0);
  check("a second copy of an old finding is new", added([a], [a, { ...a }]).length === 1);
}
{
  // Deleting a file a doc names is drift the PR introduces.
  const base = judgeRepo(repo({ "src/a.ts": "", "README.md": "See `src/a.ts`." }));
  const head = judgeRepo(repo({ "README.md": "See `src/a.ts`." }));
  check("deleting a referenced file is caught", base.length === 0 && added(base, head).length === 1);
}

console.log("baseline ratchet");
{
  const b = parseBaseline("# c\norangecat 3\nloki 0 # note\n\n");
  check("parse", b.get("orangecat") === 3 && b.get("loki") === 0);
  const r = regressions(new Map([["orangecat", 3], ["loki", 1], ["heidi", 0]]), b);
  check("only a rise regresses; an unlisted repo is allowed zero", r.length === 1 && r[0].repo === "loki");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
