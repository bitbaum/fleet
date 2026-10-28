import test from "node:test";
import assert from "node:assert/strict";
import { mayReplaceCurrencyBranch } from "./currency-branch-policy.mjs";

const bump = {
  commit: {
    message:
      "chore(deps): raise shared package floors to published versions\n\nGenerated update",
  },
};
test("bot-only branches can be refreshed", () =>
  assert.equal(mayReplaceCurrencyBranch([bump]), true));
test("consumer repairs survive subsequent currency runs", () => {
  assert.equal(
    mayReplaceCurrencyBranch([
      bump,
      { commit: { message: "fix(widget): use compact ChatKit stylesheet" } },
    ]),
    false,
  );
  assert.equal(
    mayReplaceCurrencyBranch([
      bump,
      { commit: { message: "chore(site): rebuild chat bundles" } },
    ]),
    false,
  );
});
test("absent or malformed commit evidence cannot authorize replacement", () => {
  for (const input of [null, [], [{}]])
    assert.equal(mayReplaceCurrencyBranch(input), false);
});
