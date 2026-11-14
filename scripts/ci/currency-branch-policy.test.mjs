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

const mainMerge = (subject = "Merge branch 'main' into fleet/internal-currency") => ({
  commit: { message: subject },
  parents: [{ sha: "a" }, { sha: "b" }],
});
test("a merge of main into the bump branch is not a repair (evig#682)", () => {
  assert.equal(mayReplaceCurrencyBranch([bump, mainMerge()]), true);
  assert.equal(
    mayReplaceCurrencyBranch([bump, mainMerge("Merge remote-tracking branch 'origin/main' into fleet/internal-currency")]),
    true,
  );
  assert.equal(mayReplaceCurrencyBranch([bump, mainMerge("Merge branch 'main' of https://github.com/bitbaum/evig")]), true);
});
test("any other merge, or a lone merge, still survives", () => {
  assert.equal(mayReplaceCurrencyBranch([bump, mainMerge("Merge branch 'fix/widget' into fleet/internal-currency")]), false);
  assert.equal(mayReplaceCurrencyBranch([bump, mainMerge("Merge main and fix the widget")]), false);
  assert.equal(
    mayReplaceCurrencyBranch([bump, { commit: { message: "Merge branch 'main' into fleet/internal-currency" }, parents: [{ sha: "a" }] }]),
    false,
    "one parent is not a merge, whatever its subject says",
  );
  assert.equal(mayReplaceCurrencyBranch([mainMerge()]), false, "a branch with no bump commit is not the bot's");
});
