import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedDependencies, assessRollout } from "./package-rollout-gate.mjs";
const name = "@bitbaum/sitekit",
  now = Date.parse("2026-10-24T12:00:00Z");
const settings = {
  soakHours: 24,
  packages: { [name]: { canary: "bitbaum/biaslens" } },
  blocked: {},
};
function check(overrides = {}) {
  return assessRollout({
    repo: "bitbaum/example",
    before: { [name]: "0.4.0" },
    after: { [name]: "0.4.1" },
    candidateChecks: ["ci.yml", "browser-smoke.yml"],
    settings,
    now,
    readCanary: async () => ({
      dependencies: { [name]: "0.4.1" },
      healthy: true,
      deployedAt: "2026-10-22T12:00:00Z",
    }),
    ...overrides,
  });
}
test("pnpm resolves lock-only updates and removes peer contexts", () =>
  assert.deepEqual(
    lockedDependencies(
      { dependencies: { [name]: "^0.4.0" } },
      "importers:\n  .:\n    dependencies:\n      '@bitbaum/sitekit':\n        specifier: ^0.4.0\n        version: 0.4.1(react@19)\n\npackages:\n",
    ),
    { [name]: "0.4.1" },
  ));
test("healthy soaked exact artifact promotes", async () =>
  assert.deepEqual(await check(), []));
test("canary requires browser and CI proof", async () => {
  assert.ok(
    (await check({ repo: "bitbaum/biaslens", candidateChecks: [] })).length,
  );
  assert.deepEqual(
    await check({
      repo: "bitbaum/biaslens",
      candidateChecks: ["ci.yml", "browser-smoke.yml"],
    }),
    [],
  );
});
test("wrong artifact, failed deploy, too recent or invalid receipts hold", async () => {
  for (const change of [
    { dependencies: { [name]: "0.4.0" } },
    { healthy: false },
    { deployedAt: "2026-10-24T11:00:00Z" },
    { deployedAt: undefined },
  ])
    assert.ok(
      (
        await check({
          readCanary: async () => ({
            dependencies: { [name]: "0.4.1" },
            healthy: true,
            deployedAt: "2026-10-22T12:00:00Z",
            ...change,
          }),
        })
      ).length,
    );
});
test("blocked version cannot even reach canary", async () =>
  assert.ok(
    (
      await check({
        repo: "bitbaum/biaslens",
        candidateChecks: ["ci.yml", "browser-smoke.yml"],
        settings: { ...settings, blocked: { [name]: ["0.4.1"] } },
      })
    ).length,
  ));
test("unchanged versions and third-party updates do not wait", async () =>
  assert.deepEqual(
    await check({
      before: { [name]: "0.4.1", react: "18" },
      after: { [name]: "0.4.1", react: "19" },
    }),
    [],
  ));
test("unconfigured first-party package is held", async () =>
  assert.ok(
    (await check({ before: {}, after: { "@bitbaum/new-kit": "1.0.0" } }))
      .length,
  ));

test("a newer failed or pending check cannot borrow an older green result", () => {
  for (const conclusion of ["failure", null])
    assert.deepEqual(
      successfulWorkflows([
        { path: ".github/workflows/ci.yml", event: "push", conclusion },
        {
          path: ".github/workflows/ci.yml",
          event: "push",
          conclusion: "success",
        },
      ]),
      [],
    );
});
test("missing shared lock resolution is not accepted as a version", () =>
  assert.throws(() =>
    lockedDependencies(
      { dependencies: { [name]: "^0.4.0" } },
      "importers:\n  .:\n",
    ),
  ));
