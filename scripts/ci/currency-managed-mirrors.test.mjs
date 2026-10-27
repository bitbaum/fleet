import test from "node:test";
import assert from "node:assert/strict";
import { managedMirrorFor, verifyMirrorEvidence } from "./currency-managed-mirrors.mjs";
const mirror = { path: "scripts/site-template", ownerRepo: "bitbaum/fleet", ownerPath: "templates/app", syncWorkflow: "starter-sync.yml" };
const policy = { managedConsumerMirrors: { "bitbaum/loki": [mirror] } };

test("managed starter copies update through their owner, while ordinary apps remain consumers", () => {
  assert.equal(managedMirrorFor("bitbaum/loki", "scripts/site-template/package.json", policy), mirror);
  assert.equal(managedMirrorFor("bitbaum/loki", "scripts/site-template/nested/package.json", policy), mirror);
  for (const path of ["package.json", "apps/web/package.json", "scripts/site-template-other/package.json"])
    assert.equal(managedMirrorFor("bitbaum/loki", path, policy), null);
  assert.equal(managedMirrorFor("bitbaum/fleet", "templates/app/package.json", policy), null);
  assert.equal(managedMirrorFor("bitbaum/new-app", "package.json", policy), null);
});

test("invalid ownership and unavailable synchronization evidence fail closed", () => {
  assert.throws(() => managedMirrorFor("bitbaum/loki", "package.json", {
    managedConsumerMirrors: { "bitbaum/loki": [{ ...mirror, path: "../app" }] },
  }), /invalid managed mirror/);
  verifyMirrorEvidence(mirror, path => path.endsWith(".fleet-source") ? "a".repeat(40) : "name: Sync starter");
  assert.throws(() => verifyMirrorEvidence(mirror, () => "local"), /immutable source pin/);
  assert.throws(() => verifyMirrorEvidence(mirror, path => path.endsWith(".fleet-source") ? "a".repeat(40) : ""), /synchronization workflow/);
  assert.throws(() => verifyMirrorEvidence(mirror, () => { throw new Error("unreadable"); }), /unreadable/);
});
