import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lockedDependencies,
  assessRollout,
  successfulWorkflows,
  nestedSharedArtifacts,
  nestedSharedUpdates,
  nestedSharedChange,
  dependencyIdentity,
  hasConsumerSourceChanges,
  lockedNpmDependencies,
  canaryDeploymentEvidence,
} from "./package-rollout-gate.mjs";
const name = "@bitbaum/sitekit",
  now = Date.parse("2026-10-24T12:00:00Z");
test("only consumer behavior files require browser candidate proof", () => {
  assert.equal(
    hasConsumerSourceChanges([
      { filename: "package.json" },
      { filename: "pnpm-lock.yaml" },
      { filename: "pnpm-workspace.yaml" },
      { filename: "package-plan.json" },
    ]),
    false,
  );
  assert.equal(
    hasConsumerSourceChanges([
      { filename: "pnpm-workspace.yaml" },
      { filename: "src/app/chat.tsx" },
    ]),
    true,
  );
  assert.equal(
    hasConsumerSourceChanges(
      [{ filename: "packages/ai/package.json" }, { filename: "apps/web/page.tsx" }],
      "packages/ai",
    ),
    false,
  );
});
test("aliases cannot escape first-party artifact checks", () => {
  assert.equal(dependencyIdentity("sitekit", "npm:@bitbaum/sitekit@^0.4.2"), name);
  assert.equal(dependencyIdentity("@fleet/ai-forms", "github:bitbaum/ai-forms#v0.1.3"), "ai-forms");
  assert.deepEqual(lockedDependencies({ dependencies: { sitekit: "npm:@bitbaum/sitekit@^0.4.2" } },
    "importers:\n  .:\n    dependencies:\n      sitekit:\n        specifier: npm:@bitbaum/sitekit@^0.4.2\n        version: '@bitbaum/sitekit@0.4.2(react@19)'\n"), { [name]: "0.4.2" });
  assert.throws(() => lockedDependencies({ dependencies: { sitekit: "npm:@bitbaum/sitekit@^0.4.2" } }, "importers:\n  .:\n"), /Missing locked artifact/);
});
const settings = {
  soakHours: 24,
  packages: { [name]: { canary: "bitbaum/biaslens", bootstrapPr: 42 } },
  blocked: {},
};
function check(overrides = {}) {
  return assessRollout({
    repo: "bitbaum/example",
    before: { [name]: "0.4.0" },
    after: { [name]: "0.4.1" },
    candidateChecks: ["ci.yml", "browser-smoke.yml"],
    candidatePullRequest: 42,
    settings,
    now,
    readCanary: async () => ({
      dependencies: { [name]: "0.4.1" },
      healthy: true,
      checks: ["ci.yml", "browser-smoke.yml"],
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
test("only the configured PR may bootstrap its own package canary", async () => {
  assert.deepEqual(await check({ repo: "bitbaum/biaslens", candidatePullRequest: 42 }), []);
  assert.match(
    (await check({ repo: "bitbaum/biaslens", candidatePullRequest: 43 }))[0],
    /configured bootstrap PR #42/,
  );
});
test("dependency-only UI package bumps use CI while source changes require browser proof", async () => {
  const settings = {
    soakHours: 24,
    packages: {
      [name]: {
        canary: "bitbaum/biaslens",
        candidateChecks: ["ci.yml", "browser-smoke.yml"],
        candidateDependencyChecks: ["ci.yml"],
      },
    },
    blocked: {},
  };
  const run = (candidateSourceChanged, candidateChecks) =>
    assessRollout({
      repo: "bitbaum/example",
      before: { [name]: "0.4.0" },
      after: { [name]: "0.4.1" },
      candidateSourceChanged,
      candidateChecks,
      settings,
      now,
      readCanary: async () => ({
        dependencies: { [name]: "0.4.1" },
        healthy: true,
        checks: ["ci.yml", "browser-smoke.yml"],
        deployedAt: "2026-10-22T12:00:00Z",
      }),
    });
  assert.deepEqual(await run(false, ["ci.yml"]), []);
  assert.match((await run(true, ["ci.yml"]))[0], /ci.yml and browser-smoke.yml/);
  assert.deepEqual(await run(true, ["ci.yml", "browser-smoke.yml"]), []);
});
test("template consumers may use full CI plus the exact canary soak", async () => {
  assert.deepEqual(
    await check({
      repo: "bitbaum/example",
      candidateChecks: ["ci.yml"],
      requiredChecks: ["ci.yml"],
    }),
    [],
  );
  const findings = await check({
    repo: "bitbaum/example",
    candidateChecks: ["ci.yml"],
    requiredChecks: ["ci.yml"],
    readCanary: async () => ({
      dependencies: { [name]: "0.4.1" },
      healthy: true,
        checks: ["ci.yml", "browser-smoke.yml"],
      deployedAt: "2026-10-24T11:30:00Z",
    }),
  });
  assert.match(findings[0], /soak for 24h/);
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
            checks: ["ci.yml", "browser-smoke.yml"],
            deployedAt: "2026-10-22T12:00:00Z",
            ...change,
          }),
        })
      ).length,
    );
});
test("package policy may require only checks meaningful to its surface", async () => {
  const settings = {
    soakHours: 24,
    packages: {
      "bip-kit": {
        canary: "bitbaum/biaslens",
        candidateChecks: ["ci.yml"],
        canaryChecks: ["ci.yml"],
      },
    },
  };
  const finding = async (candidateChecks, canaryChecks) =>
    assessRollout({
      repo: "bitbaum/example",
      before: { "bip-kit": "0.1.0" },
      after: { "bip-kit": "0.2.0" },
      candidateChecks,
      settings,
      now,
      readCanary: async () => ({
        dependencies: { "bip-kit": "0.2.0" },
        healthy: true,
        checks: canaryChecks,
        deployedAt: "2026-10-22T12:00:00Z",
      }),
    });
  assert.deepEqual(await finding(["ci.yml"], ["ci.yml"]), []);
  assert.match((await finding([], ["ci.yml"]))[0], /consumer needs successful ci.yml/);
  assert.match((await finding(["ci.yml"], []))[0], /pass CI\/browser checks/);
});
test("a workspace canary is the package-specific bootstrap for its importer", async () => {
  const workspacePolicy = {
    soakHours: 24,
    packages: {
      "ai-forms": {
        canary: "bitbaum/kivvi",
        canaryImporter: "apps/web",
        bootstrapPr: 141,
        candidateChecks: ["ci.yml", "browser-smoke.yml"],
      },
    },
  };
  const findings = await assessRollout({
    repo: "bitbaum/kivvi",
    before: { "ai-forms": "0.1.2" },
    after: { "ai-forms": "0.1.3" },
    candidateChecks: ["ci.yml", "browser-smoke.yml"],
    candidatePullRequest: 141,
    settings: workspacePolicy,
    now,
    readCanary: async () => {
      assert.fail("the configured bootstrap canary must not require its own soak");
    },
  });
  assert.deepEqual(findings, []);
  const wrongBootstrap = await assessRollout({
    repo: "bitbaum/kivvi",
    before: { "ai-forms": "0.1.2" },
    after: { "ai-forms": "0.1.3" },
    candidateChecks: ["ci.yml", "browser-smoke.yml"],
    candidatePullRequest: 142,
    settings: workspacePolicy,
    now,
    readCanary: async () => {
      assert.fail("a non-bootstrap PR cannot bypass deployed canary evidence");
    },
  });
  assert.match(wrongBootstrap[0], /configured bootstrap PR #141/);
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

test("nested shared importer changes cannot disappear behind unchanged root dependencies", () => {
  const lock = (version) =>
    `importers:\n  .:\n    dependencies:\n  apps/example:\n    dependencies:\n      '@bitbaum/sitekit':\n        specifier: ^0.4.0\n        version: ${version}(react@19)\n\npackages:\n`;
  assert.deepEqual(nestedSharedArtifacts(lock("0.4.1")), [
    ["apps/example", "@bitbaum/sitekit", "0.4.1"],
  ]);
  assert.notDeepEqual(
    nestedSharedArtifacts(lock("0.4.0")),
    nestedSharedArtifacts(lock("0.4.1")),
  );
});

test("nested workspace importer locks resolve aliases to canonical package artifacts", () => {
  const importer = "apps/web";
  const manifest = {
    dependencies: {
      "@fleet/ai-forms": "npm:ai-forms@^0.1.3",
      "@bitbaum/chatkit": "^0.15.3",
    },
  };
  const lock = `importers:\n  .:\n    dependencies:\n  apps/web:\n    dependencies:\n      '@fleet/ai-forms':\n        specifier: npm:ai-forms@^0.1.3\n        version: ai-forms@0.1.3(react@18)\n      '@bitbaum/chatkit':\n        specifier: ^0.15.3\n        version: 0.15.3(react@18)\n\npackages:\n`;
  assert.deepEqual(lockedDependencies(manifest, lock, importer), {
    "ai-forms": "0.1.3",
    "@bitbaum/chatkit": "0.15.3",
  });
  assert.throws(
    () => lockedDependencies(manifest, lock, "apps/missing"),
    /Missing locked artifact/,
  );
  const npmLock = {
    lockfileVersion: 3,
    packages: {
      "apps/web/node_modules/@fleet/ai-forms": { version: "0.1.3" },
      "apps/web/node_modules/@bitbaum/chatkit": { version: "0.15.3" },
    },
  };
  assert.deepEqual(lockedNpmDependencies(manifest, npmLock, importer), {
    "ai-forms": "0.1.3",
    "@bitbaum/chatkit": "0.15.3",
  });
});

test("canary deployment evidence binds checks, receipt, and lock to the exact SHA", async () => {
  const tip = "a".repeat(40);
  const lock = "lock bytes";
  const dependencies = { [name]: "0.4.1" };
  const receipt = {
    formatVersion: 1,
    repo: "bitbaum/biaslens",
    commit: tip,
    project: ".",
    createdAt: "2026-10-24T11:00:00.000Z",
    lockSha256: "unused in mock",
    artifacts: dependencies,
    versions: dependencies,
  };
  const result = await canaryDeploymentEvidence({
    canary: "bitbaum/biaslens",
    tip,
    dependencies,
    deploy: { conclusion: "success", head_sha: tip, updated_at: receipt.createdAt },
    checks: ["ci.yml", "browser-smoke.yml"],
    receiptUrl: "https://example.test/.well-known/fleet-release.json",
    lock,
    fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get("commit"), tip);
      const { createHash } = await import("node:crypto");
      receipt.lockSha256 = createHash("sha256").update(lock).digest("hex");
      return new Response(JSON.stringify(receipt), { status: 200 });
    },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.dependencies[name], "0.4.1");
  const wrongCommit = await canaryDeploymentEvidence({
    canary: "bitbaum/biaslens",
    tip,
    dependencies,
    deploy: { conclusion: "success", head_sha: "b".repeat(40), updated_at: receipt.createdAt },
    checks: ["ci.yml", "browser-smoke.yml"],
  });
  assert.equal(wrongCommit.healthy, false);
});

test("workspace receipts may cover a broader release project than the package importer", async () => {
  const tip = "e".repeat(40);
  const lock = "workspace lock bytes";
  const dependencies = { [name]: "0.4.1" };
  const receiptDependencies = { [name]: "0.4.1", "@bitbaum/chatkit": "0.15.3" };
  const { createHash } = await import("node:crypto");
  const receipt = {
    formatVersion: 1,
    repo: "bitbaum/kivvi",
    commit: tip,
    project: "apps/web",
    createdAt: "2026-10-26T00:00:00.000Z",
    lockSha256: createHash("sha256").update(lock).digest("hex"),
    artifacts: receiptDependencies,
    versions: receiptDependencies,
    projects: ["apps/web", "packages/ai"],
  };
  const result = await canaryDeploymentEvidence({
    canary: "bitbaum/kivvi",
    tip,
    dependencies,
    receiptDependencies,
    receiptProject: "apps/web",
    receiptProjects: ["apps/web", "packages/ai"],
    deploy: { conclusion: "success", head_sha: tip, updated_at: receipt.createdAt },
    checks: ["ci.yml", "browser-smoke.yml"],
    receiptUrl: "https://example.test/.well-known/fleet-release.json",
    lock,
    fetchImpl: async () => new Response(JSON.stringify(receipt), { status: 200 }),
  });
  assert.equal(result.healthy, true);
  assert.deepEqual(result.dependencies, dependencies);
});

test("retired nested workspace importers are safe while nested package updates stay held", () => {
  const lock = (version) =>
    `importers:\n  .:\n    dependencies:\n  packages/chartkit:\n    devDependencies:\n      '@bitbaum/design-tokens':\n        specifier: ^1.1.0\n        version: ${version}\n\npackages:\n`;
  const before = lock("1.1.0");
  assert.deepEqual(nestedSharedUpdates(before, "importers:\n  .:\n\npackages:\n"), []);
  assert.deepEqual(nestedSharedUpdates(before, lock("1.2.0")), [
    ["packages/chartkit", "@bitbaum/design-tokens", "1.2.0"],
  ]);
  assert.deepEqual(nestedSharedUpdates("importers:\n  .:\n\npackages:\n", lock("1.1.0")), [
    ["packages/chartkit", "@bitbaum/design-tokens", "1.1.0"],
  ]);
});

test("standalone nested manifests and locks cannot bypass the root gate", () => {
  const manifest = { dependencies: { [name]: "^0.4.0" } };
  assert.equal(
    nestedSharedChange(
      [{ filename: "frontend/pnpm-lock.yaml" }],
      () => manifest,
    ),
    true,
  );
  assert.equal(
    nestedSharedChange([{ filename: "frontend/package.json" }], (_, side) =>
      side === "head" ? manifest : null,
    ),
    true,
  );
  assert.equal(
    nestedSharedChange([{ filename: "frontend/package.json" }], () => manifest),
    false,
  );
  assert.equal(
    nestedSharedChange([{ filename: "frontend/page.tsx" }], () => manifest),
    false,
  );
  assert.equal(
    nestedSharedChange(
      [{ filename: "packages/retired-kit/package.json" }],
      (_, side) => (side === "base" ? manifest : null),
    ),
    false,
  );
});

test("obsolete AccountKit downgrade is blocked even for its bootstrap canary", async () => {
  for (const artifact of [
    "https://codeload.github.com/bitbaum/accountkit/tar.gz/ec5654270527757aa0e762f09b5aaabf272389a2",
    "git+https://github.com/bitbaum/accountkit.git#ec5654270527757aa0e762f09b5aaabf272389a2",
    "0.2.1",
  ]) {
    const findings = await assessRollout({
      repo: "bitbaum/biaslens",
      before: { "@bitbaum/accountkit": "current" },
      after: { "@bitbaum/accountkit": artifact },
      candidateChecks: ["ci.yml", "browser-smoke.yml"],
      readCanary: async () => { throw new Error("blocked artifacts must not read canary evidence"); },
    });
    assert.ok(findings.some((finding) => finding.includes("release is blocked")));
  }
});
