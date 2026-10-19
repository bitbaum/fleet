#!/usr/bin/env node
// Tests for live-claims-audit.mjs. No network: every page is a string.
import {
  DENY,
  judgePage,
  parseBaseline,
  parseClaims,
  parseRetired,
  regressions,
  sameSiteLinks,
  sitesFromMap,
  staleCopyright,
  visibleText,
} from "./live-claims-audit.mjs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const retired = parseRetired(JSON.stringify({ retired: [
  { from: "revampit.orangecat.ch", to: "evig.orangecat.ch" },
  { from: "sink", to: "too short to grep" },
] }));
const claims = parseClaims(JSON.stringify({ forbiddenClaims: [
  { pattern: "bitbaum AG\\b", why: "no such entity" },
  { pattern: "AI product studio", why: "not what bitbaum is" },
] }));

console.log("visible text");
check("scripts, styles and comments are not text", visibleText("<p>a</p><script>bitbaum AG</script><style>x</style><!-- bitbaum AG -->").trim() === "a");
check("entities for © decode", visibleText("<footer>&copy; 2024</footer>").includes("© 2024"));

console.log("copyright");
check("a past year is stale", staleCopyright("© 2025 Cato", 2026).length === 1);
check("this year is fine", staleCopyright("© 2026 Cato", 2026).length === 0);
check("a range counts by its end", staleCopyright("© 2023–2026", 2026).length === 0 && staleCopyright("Copyright 2022-2025", 2026).length === 1);
check("a year that is not a copyright is not judged", staleCopyright("founded in 2019", 2026).length === 0);

console.log("links");
const html = `<a href="/about">a</a><a href="/about#x">dup</a><a href="https://other.site/x">o</a>
<a href="/api/health">api</a><a href="/admin">adm</a><a href="mailto:x@y">m</a><a href="/doc.pdf">pdf</a><a href='/team'>t</a>`;
const links = sameSiteLinks(html, "https://heidi.orangecat.ch/");
check("same-site pages only, de-duplicated, anchors dropped", links.join() === "https://heidi.orangecat.ch/about,https://heidi.orangecat.ch/team");
check("DENY keeps auth and api off limits", DENY.test("/api/x") && DENY.test("/sign-in") && !DENY.test("/about"));

console.log("a page");
{
  const f = judgePage({
    url: "https://x/",
    html: `<a href="https://revampit.orangecat.ch/shop">old</a><p>bitbaum AG — made by sink</p><footer>© 2024</footer>`,
    year: 2026, retired, claims,
  });
  const kinds = f.map((x) => x.kind).sort().join();
  check("retired host in an href, a forbidden claim, a stale ©", kinds === "claim,copyright,retired");
  check("a short retired form is never grepped", !f.some((x) => x.token === "sink"));
}
{
  const f = judgePage({ url: "https://x/", html: "<p>Cato builds in the open.</p><footer>© 2026</footer>", year: 2026, retired, claims });
  check("a true page says nothing", f.length === 0);
}
{
  const f = judgePage({ url: "https://x/", html: "<script>const old='bitbaum AG'</script><p>ok</p>", year: 2026, retired, claims });
  check("a claim inside a script is not what a visitor reads", f.length === 0);
}

console.log("sites from the map");
{
  const s = sitesFromMap({ projects: [
    { slug: "b", urls: { live: "https://b.orangecat.ch" } },
    { slug: "a", urls: { live: "https://a.orangecat.ch/de" } },
    { slug: "a2", urls: { live: "https://a.orangecat.ch/en" } },
    { slug: "c", urls: { live: null } },
    { slug: "d", urls: { live: "not a url" } },
  ] });
  check("one per origin, sorted, nothing without a live URL", s.map((x) => x.slug).join() === "a,b");
}
check("an empty map is no sites", sitesFromMap({}).length === 0);

console.log("baseline");
{
  const b = parseBaseline("# x\nloki 2\n");
  const r = regressions(new Map([["loki", 2], ["heidi", 1]]), b);
  check("only a rise regresses", r.length === 1 && r[0].site === "heidi" && r[0].allowed === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
