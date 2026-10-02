#!/usr/bin/env node
/**
 * Self-test for own-product-signin-audit.mjs.
 * Run: node scripts/ci/test-own-product-signin-audit.mjs
 *
 * A gate that has stopped detecting prints ✓ over a drifting fleet, and a ✓
 * from a dead check is worse than no check. So every fixture asserts a verdict
 * and both sides are pinned. The payloads are shaped like the live ones taken
 * 2026-09-24. No network, no box, no secret.
 */
import {
  judge,
  ownProducts,
  orphanedBaseline,
  parseBaseline,
  providerIds,
  report,
} from "./own-product-signin-audit.mjs";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

const provider = (id, origin = "https://x.orangecat.ch") => ({
  id,
  name: id,
  type: "oauth",
  signinUrl: `${origin}/api/auth/signin/${id}`,
  callbackUrl: `${origin}/api/auth/callback/${id}`,
});
const payload = (...ids) => Object.fromEntries(ids.map((id) => [id, provider(id)]));
const ok = (p) => ({ status: 200, payload: p });
const EMPTY = parseBaseline("");

// ── who is judged ───────────────────────────────────────────────────────────
const MAP = {
  projects: [
    { slug: "loki", owner: "bitbaum", status: "live", layer: "execution", urls: { live: "https://loki.orangecat.ch" } },
    { slug: "orangecat", owner: "bitbaum", status: "live", layer: "economic", urls: { live: "https://orangecat.ch" } },
    { slug: "camille", owner: "bitbaum", status: "demo", layer: "demo", urls: { live: "https://camille.orangecat.ch" } },
    { slug: "vitareba", owner: "clinic", status: "live", layer: "client", urls: { live: "https://vitareba.orangecat.ch" } },
    { slug: "lifeops", owner: "bitbaum", status: "not live", layer: "next", urls: {} },
    { slug: "heidi", owner: "bitbaum", status: "live", layer: "product", urls: { live: "https://heidi.orangecat.ch" } },
  ],
};
check(
  "own live products are judged; the IdP, demos, clients and unshipped are not",
  ownProducts(MAP).map((p) => p.name),
  ["loki", "heidi"],
);
// The first draft read apps.conf, which omits handcrafted services — and so
// could not see Loki, the product this gate was written for.
check("Loki is judged (it is absent from apps.conf, present in the map)", ownProducts(MAP).some((p) => p.name === "loki"), true);
check("a client's app is never judged — its users belong to the client", ownProducts(MAP).some((p) => p.name === "vitareba"), false);

// ── verdicts ────────────────────────────────────────────────────────────────
check("OrangeCat only → PASS", judge("heidi", ok(payload("orangecat")), EMPTY).state, "pass");
check(
  "Loki's live 2026-09-24 payload FAILS with an empty baseline",
  judge("loki", ok(payload("orangecat", "github", "google", "email-password")), EMPTY).state,
  "fail",
);
check(
  "a password sign-in on an own product FAILS",
  judge("evig", ok(payload("orangecat", "credentials")), EMPTY).state,
  "fail",
);

const BASE = parseBaseline("petvity credentials,google  # reason\n# comment\n");
check("a baselined deviation is HELD, not passed", judge("petvity", ok(payload("orangecat", "credentials", "google")), BASE).state, "held");
check(
  "a NEW provider beside a baselined one still FAILS — the baseline cannot grow",
  judge("petvity", ok(payload("orangecat", "credentials", "google", "github")), BASE).state,
  "fail",
);
check(
  "a baselined provider that is gone FAILS until its row is deleted",
  judge("petvity", ok(payload("orangecat", "credentials")), BASE).state,
  "fail",
);
check(
  "a baseline row for something no longer an own product is reported",
  orphanedBaseline(BASE, [{ name: "loki" }]),
  ["petvity"],
);

// ── what cannot be judged SKIPs, never passes ───────────────────────────────
check("not next-auth (404) SKIPs", judge("wild-spirit", { status: 404 }, EMPTY).state, "skip");
check("unreachable SKIPs", judge("x", { status: 0, error: "ENOTFOUND" }, EMPTY).state, "skip");
check("5xx SKIPs here (nextauth-origin-audit fails it)", judge("x", { status: 500 }, EMPTY).state, "skip");
check("200 that is not a providers list SKIPs", judge("x", ok({ hello: "world" }), EMPTY).state, "skip");

// ── parsing ─────────────────────────────────────────────────────────────────
check("provider ids come out sorted", providerIds(payload("google", "orangecat", "credentials")), ["credentials", "google", "orangecat"]);
check("the baseline ignores comments and blank lines", [...parseBaseline("# a\n\nloki github,google  # why\n").get("loki")], ["github", "google"]);

// ── the report never hides a HELD row ───────────────────────────────────────
const text = report([judge("petvity", ok(payload("orangecat", "credentials", "google")), BASE)]);
check("a HELD row is printed with what it still offers", /HELD.*credentials, google/.test(text), true);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
