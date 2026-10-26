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

test("workspace canary importers must be represented in release receipts", async () => {
  const nestedPolicy = {
    packages: {
      "@bitbaum/ai-kit": {
        canary: "bitbaum/kivvi",
        canaryImporter: "packages/ai",
        receiptProject: "apps/web",
        receiptProjects: ["apps/web", "packages/ai"],
      },
    },
  };
  assert.deepEqual(await auditCanaries(nestedPolicy, async () => evidence({
    manifest: { dependencies: { "@bitbaum/ai-kit": "^1.21.4" } },
    plan: { blocks: { ai: { package: "@bitbaum/ai-kit", bindings: [{ file: "chat.tsx", symbols: ["useAI"] }] } } },
    manifestForSource: async () => ({ dependencies: { "@bitbaum/ai-kit": "^1.21.4" } }),
    readSource: async () => "import { useAI } from '@bitbaum/ai-kit/react'; useAI();",
  })), []);
  const missingReceipt = structuredClone(nestedPolicy);
  delete missingReceipt.packages["@bitbaum/ai-kit"].receiptProjects;
  assert.match(
    (await auditCanaries(missingReceipt, async () => evidence()))[0],
    /release receipt does not cover configured canary importers apps\/web, packages\/ai/,
  );
});

test("npm aliases satisfy canonical package declaration and import bindings", async () => {
  const aliasPolicy = {
    packages: { "ai-forms": { canary: "bitbaum/kivvi", bootstrapPr: 141 } },
  };
  const aliasEvidence = {
    manifest: {
      dependencies: { "@fleet/ai-forms": "npm:ai-forms@^0.1.3" },
    },
    plan: {
      blocks: {
        forms: {
          package: "ai-forms",
          bindings: [{ file: "form.tsx", symbols: ["useAiForm"] }],
        },
      },
    },
    readSource: async () =>
      "import { useAiForm } from '@fleet/ai-forms/react'; const form = useAiForm();",
  };
  assert.deepEqual(
    await auditCanaries(aliasPolicy, async () => aliasEvidence),
    [],
  );
});

test("adapter re-exports may prove package symbols at their rendered consumer", async () => {
  const plan = {
    blocks: {
      dates: {
        package: "@bitbaum/whenkit",
        bindings: [
          {
            file: "components/ui/date-input.tsx",
            symbols: ["DateInput"],
            usageFiles: ["components/review/LeadDraft.tsx"],
          },
        ],
      },
    },
  };
  const sources = {
    "components/ui/date-input.tsx":
      "import '@bitbaum/whenkit/styles.css'; export { DateInput } from '@bitbaum/whenkit/react';",
    "components/review/LeadDraft.tsx":
      "import { DateInput } from '@/components/ui/date-input'; export const Draft = () => <DateInput />;",
  };
  const result = await auditCanaries(
    {
      packages: {
        "@bitbaum/whenkit": { canary: "bitbaum/substrata", bootstrapPr: 253 },
      },
    },
    async () => ({
      manifest: { dependencies: { "@bitbaum/whenkit": "^0.3.2" } },
      plan,
      readSource: async (file) => sources[file] ?? null,
    }),
  );
  assert.deepEqual(result, []);
});
