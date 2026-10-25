import { test } from "node:test";
import assert from "node:assert/strict";
import { releasedPackage, releaseTargets } from "./package-release-target.mjs";
const pkg = {
  name: "@bitbaum/example",
  repo: "https://github.com/bitbaum/example",
  version: "9.0.0",
  install: { source: "git", command: "old" },
};
const git = { tag: "v1.2.0", version: "1.2.0", sha: "a".repeat(40) };
test("a verified newer Git release wins over lagging npm and unpublished HEAD", () => {
  const result = releasedPackage(pkg, "1.1.0", git);
  assert.equal(result.version, "1.2.0");
  assert.equal(
    result.install.command,
    `pnpm add github:bitbaum/example#${git.sha}`,
  );
  assert.equal(result.release.tag, "v1.2.0");
});
test("npm is preferred for an equal or newer stable release", () => {
  for (const version of ["1.2.0", "1.10.0"]) {
    const result = releasedPackage(pkg, version, git);
    assert.equal(result.version, version);
    assert.equal(
      result.install.command,
      `pnpm add @bitbaum/example@^${version}`,
    );
  }
});
test("unpublished and prerelease manifests cannot masquerade as stable artifacts", () => {
  assert.throws(() => releasedPackage(pkg, null, null), /no stable/);
  assert.throws(
    () => releasedPackage(pkg, "2.0.0-beta.1", { ...git, sha: "main" }),
    /no stable/,
  );
});
test("an absent npm name can use Git; an npm outage refuses partial publication", async () => {
  const [result] = await releaseTargets(
    [pkg],
    async () => ({ status: 404 }),
    async () => git,
  );
  assert.equal(result.version, "1.2.0");
  let calls = 0;
  await assert.rejects(
    releaseTargets(
      [pkg],
      async () => {
        calls++;
        return { status: 503 };
      },
      async () => git,
    ),
    /HTTP 503/,
  );
  assert.equal(calls, 3);
});

test("all registry reads finish before synchronous Git verification begins", async () => {
  let resolved = 0;
  const packages = [pkg, { ...pkg, name: "@bitbaum/second" }];
  await releaseTargets(
    packages,
    async () => {
      await new Promise((done) => setTimeout(done, 5));
      resolved++;
      return {
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.2.0" } }),
      };
    },
    () => {
      assert.equal(resolved, 2);
      return git;
    },
  );
});

test("transient network failures retry but an unavailable registry is never guessed", async () => {
  let calls = 0;
  const [result] = await releaseTargets(
    [pkg],
    async () => {
      if (++calls < 3) throw new Error("connection reset");
      return { status: 404 };
    },
    () => git,
  );
  assert.equal(result.version, "1.2.0");
  assert.equal(calls, 3);
  await assert.rejects(
    releaseTargets(
      [pkg],
      async () => {
        throw new Error("offline");
      },
      () => git,
    ),
    /unavailable/,
  );
});
