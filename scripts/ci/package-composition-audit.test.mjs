import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditComposition } from "./package-composition-audit.mjs";
const baseline = { shell: { package: "@bitbaum/sitekit" } };
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "composition-"));
  try {
    mkdirSync(join(dir, ".github"));
    mkdirSync(join(dir, ".github/workflows"));
    writeFileSync(
      join(dir, ".github/workflows/auto-merge.yml"),
      "name: Auto-merge",
    );
    writeFileSync(join(dir, ".github/workflows/deploy.yml"), "name: Deploy");
    writeFileSync(
      join(dir, ".github/dependabot.yml"),
      "updates:\n- package-ecosystem: npm\n",
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@bitbaum/sitekit": "^0.4.0" } }),
    );
    writeFileSync(
      join(dir, "package-plan.json"),
      JSON.stringify({
        blocks: {
          shell: {
            package: "@bitbaum/sitekit",
            bindings: [{ file: "shell.tsx", symbols: ["SiteMasthead"] }],
          },
        },
      }),
    );
    writeFileSync(
      join(dir, "shell.tsx"),
      "import {SiteMasthead} from '@bitbaum/sitekit/react'; export const Shell=()=> <SiteMasthead />;",
    );
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("declared installed and rendered building block passes", () =>
  fixture((dir) => assert.deepEqual(auditComposition(dir, baseline), [])));
test("a package adapter may prove its exported component at a rendered consumer", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "package-plan.json"),
      JSON.stringify({
        blocks: {
          shell: {
            package: "@bitbaum/sitekit",
            bindings: [
              {
                file: "adapter.tsx",
                symbols: ["SiteMasthead"],
                usageFiles: ["page.tsx"],
              },
            ],
          },
        },
      }),
    );
    writeFileSync(
      join(dir, "adapter.tsx"),
      "import {SiteMasthead} from '@bitbaum/sitekit/react'; export {SiteMasthead};",
    );
    writeFileSync(
      join(dir, "page.tsx"),
      "import {SiteMasthead} from './adapter'; export const Page=()=> <SiteMasthead />;",
    );
    assert.deepEqual(auditComposition(dir, baseline), []);
  }));
test("npm and Git aliases bind to the canonical shared package", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@bitbaum/sitekit": "^0.4.0",
          listkit: "github:bitbaum/listkit#cca70801aacbbf5310c976b0610ca469ba869e97",
        },
      }),
    );
    writeFileSync(
      join(dir, "package-plan.json"),
      JSON.stringify({
        blocks: {
          shell: {
            package: "@bitbaum/sitekit",
            bindings: [{ file: "shell.tsx", symbols: ["SiteMasthead"] }],
          },
          lists: {
            package: "@bitbaum/listkit",
            bindings: [{ file: "list.tsx", symbols: ["applyQuery"] }],
          },
        },
      }),
    );
    writeFileSync(
      join(dir, "list.tsx"),
      "import {applyQuery} from 'listkit'; export const list = (rows, spec) => applyQuery(rows, spec);",
    );
    assert.deepEqual(
      auditComposition(dir, {
        ...baseline,
        lists: { package: "@bitbaum/listkit" },
      }),
      [],
    );
  }));
test("dependency-only adoption fails when the rendered binding disappears", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "shell.tsx"),
      "import {SiteMasthead} from '@bitbaum/sitekit/react'; export const Shell=()=> <header>Custom</header>;",
    );
    assert.ok(
      auditComposition(dir, baseline).some((x) => x.includes("not used")),
    );
  }));
test("required feature surfaces are checked against the product tree", () =>
  fixture((dir) => {
    const path = join(dir, "package-plan.json");
    const plan = JSON.parse(readFileSync(path, "utf8"));
    plan.blocks.shell.surfaces = ["src/app/roadmap/page.tsx", "src/app/changelog/page.tsx"];
    writeFileSync(path, JSON.stringify(plan));
    const findings = auditComposition(dir, baseline);
    assert.equal(findings.filter((x) => x.includes("required product surface")).length, 2);
    mkdirSync(join(dir, "src/app/roadmap"), { recursive: true });
    mkdirSync(join(dir, "src/app/changelog"), { recursive: true });
    writeFileSync(join(dir, "src/app/roadmap/page.tsx"), "export default function Roadmap() {}");
    writeFileSync(join(dir, "src/app/changelog/page.tsx"), "export default function Changelog() {}");
    assert.deepEqual(auditComposition(dir, baseline), []);
  }));
test("a missing package plan fails before a product can claim a shared foundation", () =>
  fixture((dir) => {
    rmSync(join(dir, "package-plan.json"));
    assert.ok(
      auditComposition(dir, baseline)[0].includes("Missing package-plan"),
    );
  }));
test("an undocumented exception cannot bypass adoption", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "package-plan.json"),
      JSON.stringify({ blocks: { shell: { exception: "faster" } } }),
    );
    assert.ok(auditComposition(dir, baseline).length);
  }));

test("a block may bind through the shared package that wraps it (via)", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@bitbaum/sitekit": "^0.4.0",
          "@bitbaum/mail-kit": "^0.2.0",
          "@bitbaum/accountkit": "^0.25.0",
        },
      }),
    );
    const plan = (via) =>
      JSON.stringify({
        blocks: {
          shell: {
            package: "@bitbaum/sitekit",
            bindings: [{ file: "shell.tsx", symbols: ["SiteMasthead"] }],
          },
          mail: {
            package: "@bitbaum/mail-kit",
            bindings: [{ file: "auth.ts", symbols: ["createAuthMailer"], ...(via ? { via } : {}) }],
          },
        },
      });
    writeFileSync(
      join(dir, "auth.ts"),
      "import { createAuthMailer } from '@bitbaum/accountkit/auth/mail'; export const m = createAuthMailer({});",
    );
    const mailFindings = (via) => {
      writeFileSync(join(dir, "package-plan.json"), plan(via));
      return auditComposition(dir, { ...baseline, mail: { package: "@bitbaum/mail-kit" } }).filter((f) =>
        f.startsWith("mail:"),
      );
    };
    assert.deepEqual(mailFindings(null), ["mail: auth.ts does not import its declared package"]);
    assert.deepEqual(mailFindings("@bitbaum/accountkit"), []);
    assert.deepEqual(mailFindings("@bitbaum/chatkit"), [
      "mail: @bitbaum/chatkit (via) is not installed",
      "mail: auth.ts does not import its declared package",
    ]);
  }));

test("a product that sets an experience ceiling may not exceed it; one without only reports", () => {
  fixture((dir) => {
    writeFileSync(join(dir, "Notes.tsx"), "export const A = () => <textarea />;");
    const free = auditComposition(dir, baseline);
    assert.ok(!free.some((f) => /ceiling/.test(f)), free.join("\n"));
    const plan = JSON.parse(readFileSync(join(dir, "package-plan.json"), "utf8"));
    plan.experience = { ceiling: {} };
    writeFileSync(join(dir, "package-plan.json"), JSON.stringify(plan));
    const held = auditComposition(dir, baseline);
    assert.ok(held.some((f) => /bareTextareas: 1 above the ceiling of 0/.test(f)), held.join("\n"));
    plan.experience = { ceiling: { bareTextareas: 1 } };
    writeFileSync(join(dir, "package-plan.json"), JSON.stringify(plan));
    assert.deepEqual(auditComposition(dir, baseline), []);
  });
});
test("old and scoped names of a migrating package satisfy each other", () => {
  for (const [planned, required] of [
    ["@bitbaum/bip-kit", "bip-kit"],
    ["bip-kit", "@bitbaum/bip-kit"],
  ])
    fixture((dir) => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { [planned]: "^0.6.1" } }),
      );
      writeFileSync(
        join(dir, "package-plan.json"),
        JSON.stringify({
          blocks: {
            publishing: {
              package: planned,
              bindings: [{ file: "shell.tsx", symbols: ["Shell"] }],
            },
          },
        }),
      );
      writeFileSync(
        join(dir, "shell.tsx"),
        `import {Shell} from '${planned}/react'; export const Page=()=> <Shell />;`,
      );
      assert.deepEqual(
        auditComposition(dir, { publishing: { package: required } }),
        [],
      );
    });
});
