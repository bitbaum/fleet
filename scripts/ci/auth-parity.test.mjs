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
  assert.deepEqual(de, { OC: true, MOR: false, PK: true, ML: true, REC: true, EP: true });
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
    methods: Object.fromEntries(["EP", "ML", "PK", "2FA", "REC", "OC", "MOR"].map((m) => [m, ok])),
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
  }
});
