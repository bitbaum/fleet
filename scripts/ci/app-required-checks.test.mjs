import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertGreen,
  policyFor,
  CHECKS,
  REPO_CHECKS,
} from "./app-required-checks.mjs";
const sha = "a".repeat(40);
const green = () =>
  CHECKS.map((name, id) => ({
    name,
    id,
    head_sha: sha,
    app: { id: 15368 },
    status: "completed",
    conclusion: "success",
  }));
test("only the latest successful exact-commit GitHub Actions checks qualify", () => {
  assert.doesNotThrow(() => assertGreen(green(), sha));
  for (const change of [
    { head_sha: "b".repeat(40) },
    { app: { id: 99 } },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
  ])
    assert.throws(() =>
      assertGreen([{ ...green()[0], ...change }, green()[1]], sha),
    );
  assert.throws(() =>
    assertGreen(
      [...green(), { ...green()[0], id: 20, conclusion: "failure" }],
      sha,
    ),
  );
  assert.throws(() => assertGreen([], sha));
});
test("new protection requires both authenticated app checks for admins too", () => {
  const p = policyFor();
  assert.equal(p.enforce_admins, true);
  assert.equal(p.required_status_checks.strict, true);
  assert.deepEqual(
    p.required_status_checks.checks,
    CHECKS.map((context) => ({ context, app_id: 15368 })),
  );
  assert.equal(p.required_pull_request_reviews, null);
  assert.equal(p.allow_force_pushes, false);
  assert.equal(p.allow_deletions, false);
});
test("existing stronger review and push constraints are retained", () => {
  const reviews = {
    required_approving_review_count: 2,
    dismiss_stale_reviews: true,
  };
  const p = policyFor({
    required_status_checks: {
      contexts: ["legacy"],
      checks: [{ context: "security", app_id: 42 }],
    },
    required_pull_request_reviews: reviews,
    restrictions: {
      users: [{ login: "maintainer" }],
      teams: [{ slug: "core" }],
      apps: [{ slug: "release" }],
    },
    required_linear_history: { enabled: true },
    required_conversation_resolution: { enabled: true },
  });
  assert.deepEqual(p.required_pull_request_reviews, reviews);
  assert.deepEqual(p.restrictions, {
    users: ["maintainer"],
    teams: ["core"],
    apps: ["release"],
  });
  assert.ok(p.required_linear_history && p.required_conversation_resolution);
  assert.ok(
    p.required_status_checks.checks.some(
      (c) => c.context === "security" && c.app_id === 42,
    ),
  );
  assert.ok(
    p.required_status_checks.checks.some((c) => c.context === "legacy"),
  );
});

test("Fleet requires rendered starter checks as well as verification", () => {
  const required = REPO_CHECKS.fleet;
  assert.deepEqual(required, ["verify", "app-template"]);
  assert.throws(() => assertGreen(green(), sha, required));
  const checks = required.map((name, id) => ({
    name,
    id,
    head_sha: sha,
    app: { id: 15368 },
    status: "completed",
    conclusion: "success",
  }));
  assert.doesNotThrow(() => assertGreen(checks, sha, required));
  assert.deepEqual(
    policyFor(null, required).required_status_checks.checks,
    required.map((context) => ({ context, app_id: 15368 })),
  );
});
