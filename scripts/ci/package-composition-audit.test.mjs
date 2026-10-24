import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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
