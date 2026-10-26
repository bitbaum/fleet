import { test } from "node:test";
import assert from "node:assert/strict";
import { auditCanaries } from "./package-canary-audit.mjs";

const name = "@bitbaum/chatkit";
const policy = { packages: { [name]: { canary: "bitbaum/example" } } };
const evidence = (overrides = {}) => ({
  manifest: { dependencies: { [name]: "^0.15.2" } },
  plan: {
    blocks: {
      chat: {
        package: name,
        bindings: [{ file: "chat.tsx", symbols: ["Composer"] }],
      },
    },
  },
  readSource: async () =>
    "import { Composer } from '@bitbaum/chatkit/react'; export const Chat = () => <Composer />;",
  ...overrides,
});
test("a canary must declare and execute the package", async () => {
  assert.deepEqual(await auditCanaries(policy, async () => evidence()), []);
  assert.match(
    (await auditCanaries(policy, async () => evidence({ manifest: {} })))[0],
    /does not declare/,
  );
  for (const source of [
    "// @bitbaum/chatkit Composer()",
    "import {Composer} from '@bitbaum/chatkit/react'; export const Chat=()=>null;",
  ])
    assert.match(
      (
        await auditCanaries(policy, async () =>
          evidence({ readSource: async () => source }),
        )
      )[0],
      /no declared runtime binding/,
    );
});
test("missing and unavailable evidence is not a pass", async () => {
  assert.match(
    (
      await auditCanaries(policy, async () => {
        throw new Error("unavailable");
      })
    )[0],
    /unavailable/,
  );
  assert.match(
    (await auditCanaries(policy, async () => evidence({ plan: {} })))[0],
    /no declared/,
  );
  assert.match(
    (
      await auditCanaries({ packages: { [name]: {} } }, async () => evidence())
    )[0],
    /invalid/,
  );
});

test("bootstrap PR identity is forwarded to canary evidence", async () => {
  let args;
  const configured = {
    packages: {
      [name]: { canary: "bitbaum/substrata", bootstrapPr: 252 },
    },
  };
  const findings = await auditCanaries(configured, async (...received) => {
    args = received;
    return evidence();
  });
  assert.deepEqual(findings, []);
  assert.deepEqual(args, ["bitbaum/substrata", 252]);
});
