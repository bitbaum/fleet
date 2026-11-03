// Pins the verdicts of auth-parity.mjs: what fails the daily run, what only
// gets reported. Run: node --test scripts/ci/auth-parity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPS_PATH,
  authorizeAccepted,
  mounted,
  renderReport,
  shownMethods,
  standardFailures,
  verdict,
} from "./auth-parity.mjs";

test("a configured method missing from the page fails", () => {
  assert.deepEqual(verdict({ c: true, shown: false, broken: null }), { state: "missing", fail: true });
});

test("a shown method that is broken fails", () => {
  assert.deepEqual(verdict({ c: true, shown: true, broken: "refused: invalid_client" }), {
    state: "broken",
    fail: true,
  });
});

test("a method that is not configured and not shown is reported, not failed", () => {
  assert.deepEqual(verdict({ c: false, shown: false, broken: null }), { state: "off", fail: false });
  assert.deepEqual(verdict({ c: null, shown: false, broken: null }), { state: "off", fail: false });
});

test("2FA is never on the page: served counts, not shown", () => {
  assert.deepEqual(verdict({ c: true, shown: null, broken: null }), { state: "ok", fail: false });
  assert.deepEqual(verdict({ c: false, shown: null, broken: null }), { state: "off", fail: false });
});

test("the page decides where the runtime cannot say", () => {
  assert.deepEqual(verdict({ c: null, shown: true, broken: null }), { state: "shown", fail: false });
});

test("page reading: AccountKit's own labels, in German and English", () => {
  const de = shownMethods({
    clickables: [
      "Weiter mit OrangeCat",
      "Mit Passkey anmelden",
      "Anmelden",
      "Stattdessen einen Anmeldelink per E-Mail schicken",
      "Passwort vergessen?",
    ],
    passwordInputs: 1,
    links: [],
  });
  assert.deepEqual(de, { OC: true, MOR: false, PK: true, ML: true, REC: true, LN: false, EP: true });
  const en = shownMethods({
    clickables: ["Continue with Google, Apple, GitHub, X or Facebook", "Sign in"],
    passwordInputs: 0,
    links: [{ text: "Forgot?", href: "https://x.example/forgot-password" }],
  });
  assert.equal(en.MOR, true);
  assert.equal(en.OC, false);
  assert.equal(en.REC, true, "a recovery link is read from its address");
  assert.equal(en.EP, false, "no password field and no password button");
});

test("a product's own GitHub button is not Morulia's", () => {
  const ui = { clickables: ["Continue with OrangeCat", "Continue with GitHub"], passwordInputs: 1, links: [] };
  assert.equal(shownMethods(ui).MOR, true, "without the flag it reads as Morulia");
  assert.equal(shownMethods(ui, { ownProviders: ["github"] }).MOR, false);
  const both = { ...ui, clickables: [...ui.clickables, "Continue with Google, Apple, GitHub, X or Facebook"] };
  assert.equal(shownMethods(both, { ownProviders: ["github"] }).MOR, true);
});

test("Lightning login is read off the page in every language AccountKit ships", () => {
  for (const label of ["Sign in with a Lightning wallet", "Mit einer Lightning-Wallet anmelden", "Se connecter avec un portefeuille Lightning"])
    assert.equal(shownMethods({ clickables: [label], passwordInputs: 0, links: [] }).LN, true, label);
});

test("better-auth: a validation error means mounted, a 404 means not", () => {
  assert.equal(mounted(400, { code: "VALIDATION_ERROR" }), true);
  assert.equal(mounted(200, { challenge: "x" }), true);
  assert.equal(mounted(404, { code: "NOT_FOUND" }), false);
  assert.equal(mounted(400, null), false, 'Auth.js answers "Bad request." as text');
});

test("the authorize leg: accepted, refused, sent elsewhere", () => {
  const idp = "https://orangecat.ch/oauth/authorize?client_id=x";
  assert.equal(authorizeAccepted(idp, 307, "https://orangecat.ch/auth?next=%2Foauth"), null);
  assert.match(authorizeAccepted(idp, 302, "https://orangecat.ch/auth?error=invalid_client"), /invalid_client/);
  assert.match(authorizeAccepted(idp, 302, "https://evil.example/"), /elsewhere/);
  assert.match(authorizeAccepted(idp, 400, null), /400/);
});

test("the report names every failure", () => {
  const ok = { configured: true, shown: true, broken: null, state: "ok", fail: false };
  const row = {
    name: "app",
    runtime: "accountkit",
    methods: Object.fromEntries(["EP", "ML", "PK", "2FA", "REC", "OC", "MOR", "LN"].map((m) => [m, ok])),
    failures: ["PK is configured but not on /sign-in"],
  };
  const md = renderReport([row], "2026-11-01");
  assert.match(md, /\| app \| accountkit \| yes/);
  assert.match(md, /\*\*app\*\*: PK is configured but not on \/sign-in/);
});

test("the app list is well formed", () => {
  const { apps } = JSON.parse(readFileSync(APPS_PATH, "utf8"));
  const names = new Set();
  for (const a of apps) {
    assert.ok(!names.has(a.name), `${a.name} listed twice`);
    names.add(a.name);
    assert.match(a.origin, /^https:\/\/[a-z0-9.-]+$/, a.name);
    assert.match(a.signIn, /^\//, a.name);
    assert.ok(["accountkit", "compat", "authjs", "gotrue", "legacy"].includes(a.runtime), a.name);
    if (a.standard) assert.ok(["accountkit", "compat"].includes(a.runtime), `${a.name}: the standard is AccountKit`);
    if (a.served === false) assert.ok(a.note, `${a.name}: say why it is not served`);
  }
});

const ok = { state: "ok" };
const allOn = Object.fromEntries(["EP", "ML", "PK", "2FA", "REC", "OC", "MOR", "LN"].map((m) => [m, ok]));
const words = { createAccount: new Set(["Konto erstellen", "Create an account"]), signIn: new Set(["Anmelden", "Sign in"]) };
const app = { signIn: "/de/sign-in", signUp: "/de/sign-up" };
const signInPage = (clickables, linkText = "Konto erstellen") => ({
  clickables,
  links: [{ text: linkText, href: "https://x.example/de/sign-up?next=%2Fde" }],
});
const signUpPage = { clickables: [], links: [{ text: "Anmelden", href: "https://x.example/de/sign-in" }] };
const DE = [
  "Weiter mit OrangeCat",
  "Mit Passkey anmelden",
  "Anmelden",
  "Stattdessen einen Anmeldelink per E-Mail schicken",
  "Passwort vergessen?",
  "Konto erstellen",
];

test("the standard: AccountKit's screens as drawn pass", () => {
  assert.deepEqual(standardFailures({ app, methods: allOn, signIn: signInPage(DE), signUp: signUpPage, words }), []);
});

test("the standard: a method switched off fails, MOR does not", () => {
  const methods = { ...allOn, PK: { state: "off" }, MOR: { state: "off" } };
  const out = standardFailures({ app, methods, signIn: signInPage(DE), signUp: signUpPage, words });
  assert.deepEqual(out, ["PK is off, below the standard"]);
});

test("the standard: recovery above the sign-in link is out of order (Loki's own form)", () => {
  const loki = ["Continue with OrangeCat", "Sign in with a passkey", "Forgot password?", "Sign in", "Email me a sign-in link instead"];
  const out = standardFailures({ app, methods: allOn, signIn: signInPage(loki, "Create an account"), signUp: signUpPage, words });
  assert.equal(out.length, 1);
  assert.match(out[0], /REC comes before ML/);
});

test("the standard: the switch links say AccountKit's words", () => {
  const out = standardFailures({ app, methods: allOn, signIn: signInPage(DE, "Jetzt starten"), signUp: signUpPage, words });
  assert.deepEqual(out, ['the link to /de/sign-up says "Jetzt starten", not AccountKit\'s words']);
  const none = standardFailures({ app, methods: allOn, signIn: { clickables: DE, links: [] }, signUp: signUpPage, words });
  assert.deepEqual(none, ["no link to /de/sign-up on the sign-in page"]);
  assert.deepEqual(
    standardFailures({ app, methods: allOn, signIn: signInPage(DE, "Jetzt starten"), signUp: signUpPage, words: null }),
    [],
    "without the package, wording is not judged",
  );
});

test("an app that is not served is listed, not probed", () => {
  const md = renderReport([{ name: "keller", runtime: "accountkit", notServed: "keller#9", failures: [] }], "2026-11-02");
  assert.match(md, /\| keller \| accountkit \|.*not served \(keller#9\)/);
  assert.match(md, /No failures/);
});
