import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registeredGitDependency,
  planGitUpdate,
  planRegistryMigration,
  latestVerifiedGitRelease,
} from "./git-package-currency.mjs";
const sha = "a".repeat(40),
  old = "b".repeat(40);
const registry = {
  packages: [
    {
      name: "@bitbaum/accountkit",
      repo: "https://github.com/bitbaum/accountkit",
    },
  ],
};
test("immutable registered Git dependencies are recognized across supported spellings", () => {
  for (const spec of [
    `github:bitbaum/accountkit#v0.2.1`,
    `git+https://github.com/bitbaum/accountkit.git#${old}`,
  ])
    assert.equal(
      registeredGitDependency(spec, registry).repo,
      "bitbaum/accountkit",
    );
  for (const spec of [
    "github:someone/accountkit#v1.0.0",
    "github:bitbaum/accountkit#main",
    "workspace:*",
    "^0.5.0",
  ])
    assert.equal(registeredGitDependency(spec, registry), null);
});
test("Git updates preserve the dependency alias and pin immutable commits without downgrades", () => {
  const target = {
    name: "@bitbaum/accountkit",
    sha,
    version: "0.6.0",
    currentVersion: "0.2.1",
  };
  const update = planGitUpdate(
    "app",
    "frontend/package.json",
    "account-alias",
    "github:bitbaum/accountkit#v0.2.1",
    target,
  );
  assert.equal(update.name, "account-alias");
  assert.equal(update.to, `github:bitbaum/accountkit#${sha}`);
  for (const currentVersion of ["0.6.0", "0.7.0", undefined])
    assert.equal(
      planGitUpdate(
        "app",
        "package.json",
        "x",
        `github:bitbaum/accountkit#${old}`,
        { ...target, currentVersion },
      ),
      null,
    );
});
test("only matching stable versions with successful exact-commit CI are eligible", () => {
  const responses =
    (conclusion, declaredVersion = "0.6.0") =>
    (path) => {
      if (path.includes("matching-refs"))
        return [
          { ref: "refs/tags/v0.6.0" },
          { ref: "refs/tags/v0.7.0-beta.1" },
        ];
      if (path.includes("/commits/")) return { sha };
      if (path.includes("contents"))
        return {
          content: Buffer.from(
            JSON.stringify({ version: declaredVersion }),
          ).toString("base64"),
        };
      return {
        workflow_runs: [
          { path: ".github/workflows/ci.yml", event: "push", conclusion },
        ],
      };
    };
  assert.equal(
    latestVerifiedGitRelease("bitbaum/accountkit", responses("success")).sha,
    sha,
  );
  for (const state of [null, "failure", "cancelled"])
    assert.equal(
      latestVerifiedGitRelease("bitbaum/accountkit", responses(state)),
      null,
    );
  assert.equal(
    latestVerifiedGitRelease(
      "bitbaum/accountkit",
      responses("success", "0.5.2"),
    ),
    null,
  );
});
test("published packages migrate from Git without changing aliases or downgrading", () => {
  const identity = { name: "@bitbaum/chatkit", npm: true };
  assert.equal(
    planRegistryMigration(
      "app",
      "package.json",
      "chat",
      "github:bitbaum/chatkit#v0.1.0",
      identity,
      "0.1.0",
      "0.15.2",
    ).to,
    "npm:@bitbaum/chatkit@^0.15.2",
  );
  assert.equal(
    planRegistryMigration(
      "app",
      "package.json",
      identity.name,
      "git",
      identity,
      "0.15.2",
      "0.15.2",
    ).to,
    "^0.15.2",
  );
  assert.equal(
    planRegistryMigration(
      "app",
      "package.json",
      identity.name,
      "git",
      identity,
      "0.16.0",
      "0.15.2",
    ),
    null,
  );
  assert.equal(
    planRegistryMigration(
      "app",
      "package.json",
      "listkit",
      "git",
      { name: "listkit", npm: false },
      "0.1.0",
      "1.0.0",
    ),
    null,
  );
});
