import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const workflow = readFileSync(
  new URL(
    "../../templates/package/.github/workflows/release.yml",
    import.meta.url,
  ),
  "utf8",
);
const start = workflow.indexOf("          git add package.json\n");
const end = workflow.indexOf("          git commit", start);
assert.ok(start >= 0 && end > start, "release staging block exists");
const staging = workflow
  .slice(start, end)
  .split("\n")
  .map((line) => line.slice(10))
  .join("\n");
// Hook-exported Git settings must never retarget a fixture at a real checkout.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

for (const kind of [
  "absent",
  "ignored",
  "tracked-ignored",
  "tracked",
  "deleted",
]) {
  test(`release stages the intended files with ${kind} build output`, () => {
    const root = mkdtempSync(join(tmpdir(), "fleet-release-staging-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      writeFileSync(join(root, "package.json"), '{"version":"0.0.0"}\n');
      writeFileSync(
        join(root, ".gitignore"),
        kind.includes("ignored") ? "dist/\n" : "",
      );
      git("add", "package.json", ".gitignore");
      const tracked = kind.startsWith("tracked") || kind === "deleted";
      if (tracked) {
        mkdirSync(join(root, "dist"));
        writeFileSync(join(root, "dist/index.js"), "old\n");
        git("add", "-f", "dist/index.js");
      }
      git(
        "-c",
        "user.name=Release fixture",
        "-c",
        "user.email=fixture@bitbaum.invalid",
        "commit",
        "-qm",
        "baseline",
      );
      writeFileSync(join(root, "package.json"), '{"version":"0.0.1"}\n');
      if (kind === "deleted") rmSync(join(root, "dist"), { recursive: true });
      else if (kind !== "absent") {
        mkdirSync(join(root, "dist"), { recursive: true });
        writeFileSync(join(root, "dist/index.js"), "new\n");
        writeFileSync(join(root, "dist/extra.js"), "extra\n");
      }
      execFileSync("bash", ["-e", "-o", "pipefail", "-c", staging], {
        cwd: root,
        env,
      });
      const expected = ["package.json"];
      if (tracked) expected.push("dist/index.js");
      if (kind === "tracked") expected.push("dist/extra.js");
      assert.deepEqual(
        git("diff", "--cached", "--name-only").split("\n").sort(),
        expected.sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
