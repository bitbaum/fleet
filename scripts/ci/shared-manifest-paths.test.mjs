import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestPaths } from "./shared-registry-audit.mjs";
test("discover nested apps, local packages, examples and generated starter sources", () => {
  const paths = [
    "package.json",
    "templates/app/package.json",
    "apps/studio/package.json",
    "packages/tax-model/package.json",
    "examples/next/package.json",
    "frontend/package.json",
  ];
  assert.deepEqual(
    manifestPaths({ tree: paths.map((path) => ({ path, type: "blob" })) }),
    paths.sort(),
  );
});
test("ignore installed/generated manifests, fixtures and directories", () => {
  const paths = [
    "node_modules/a/package.json",
    "dist/package.json",
    ".next/package.json",
    "test/fixtures/package.json",
    "test/__fixtures__/a/package.json",
    "coverage/package.json",
  ];
  assert.deepEqual(
    manifestPaths({
      tree: [
        ...paths.map((path) => ({ path, type: "blob" })),
        { path: "package.json", type: "tree" },
      ],
    }),
    [],
  );
});
test("a truncated or unavailable tree cannot publish complete-looking facts", () => {
  assert.throws(
    () => manifestPaths({ truncated: true, tree: [] }),
    /incomplete/,
  );
  assert.throws(() => manifestPaths({}), /unavailable/);
});
