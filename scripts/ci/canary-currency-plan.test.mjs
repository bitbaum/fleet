import { test } from "node:test";
import assert from "node:assert/strict";
import { canaryFirst } from "./canary-currency-plan.mjs";
const policy = { packages: {
  design: { canary: "bitbaum/style-app" },
  search: { canary: "bitbaum/search-app" },
  chat: { canary: "bitbaum/chat-app", additionalCanaries: [{ canary: "bitbaum/case-app" }] },
} };
const bump = (packageName) => ({ name: packageName, packageName, path: "package.json", sourceSha: "a".repeat(40), from: "^1.0.0", to: "^1.1.0" });
test("two canaries cannot wait on each other's ordinary dependency bump", () => {
  const planned = canaryFirst([
    { repo: "style-app", bumps: [bump("design"), bump("search")] },
    { repo: "search-app", bumps: [bump("design"), bump("search")] },
  ], policy);
  assert.deepEqual(planned.map(p => p.bumps.map(b => b.packageName)), [["design"], ["search"]]);
  assert.deepEqual(planned.map(p => p.deferredBumps.map(b => b.packageName)), [["search"], ["design"]]);
});
test("once a canary is current its deferred ordinary updates are planned normally", () => {
  const entry = { repo: "style-app", bumps: [bump("search")] };
  assert.deepEqual(canaryFirst([entry], policy), [entry]);
});
test("additional representatives, aliases and nested importer leases are preserved", () => {
  const chat = { ...bump("chat"), name: "chat-alias", path: "apps/web/package.json" };
  const entry = { repo: "bitbaum/case-app", bumps: [bump("search"), chat] };
  const result = canaryFirst([entry], policy)[0];
  assert.deepEqual(result.bumps, [chat]);
  assert.equal(result.bumps[0].sourceSha, chat.sourceSha);
  assert.equal(entry.bumps.length, 2);
});
test("ordinary consumers and unchanged batches retain all updates", () => {
  const ordinary = { repo: "ordinary-app", bumps: [bump("design"), bump("search")] };
  const onlyOwned = { repo: "search-app", bumps: [bump("search")] };
  assert.deepEqual(canaryFirst([ordinary, onlyOwned], policy), [ordinary, onlyOwned]);
});
