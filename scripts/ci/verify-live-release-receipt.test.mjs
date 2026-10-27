import test from "node:test";
import assert from "node:assert/strict";
import { verifyLiveReceipt } from "./verify-live-release-receipt.mjs";

const expected = {
  formatVersion: 1, repo: "bitbaum/example", commit: "a".repeat(40),
  project: ".", projects: ["."], createdAt: "2026-10-27T00:00:00Z",
  lockSha256: "b".repeat(64), artifacts: { "@bitbaum/chatkit": "0.20.0" },
  versions: { "@bitbaum/chatkit": "0.20.0" },
};
const response = value => async () => ({ ok: true, json: async () => value });

test("accepts the complete deployed contract and bypasses stale caches", async () => {
  await verifyLiveReceipt("https://example.com/.well-known/fleet-release.json", expected,
    async (url, options) => {
      assert.equal(url.searchParams.get("fleet_commit"), expected.commit);
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => expected };
    });
});

test("rejects a wrong commit, lock, project or complete artifact map", async () => {
  for (const change of [
    { commit: "c".repeat(40) }, { lockSha256: "d".repeat(64) },
    { project: "other" }, { artifacts: {} },
    { artifacts: { ...expected.artifacts, "@bitbaum/ai-kit": "1.21.4" } },
    { versions: { "@bitbaum/chatkit": "0.19.0" } },
  ]) {
    await assert.rejects(verifyLiveReceipt("https://example.com/receipt", expected,
      response({ ...expected, ...change })), /does not match/);
  }
});

test("unavailable and malformed evidence never certifies a deployment", async () => {
  await assert.rejects(verifyLiveReceipt("https://example.com/receipt", expected,
    async () => ({ ok: false, status: 404 })), /HTTP 404/);
  await assert.rejects(verifyLiveReceipt("https://example.com/receipt", expected,
    async () => ({ ok: true, json: async () => { throw new Error("invalid JSON"); } })), /invalid JSON/);
});

test("does not send requests over HTTP or with embedded credentials", async () => {
  for (const url of ["http://example.com/receipt", "https://user:password@example.com/receipt"]) {
    await assert.rejects(verifyLiveReceipt(url, expected,
      async () => assert.fail("unsafe request made")), /credential-free HTTPS/);
  }
});
