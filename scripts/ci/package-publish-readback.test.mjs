import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const workflow = readFileSync(
  new URL(
    "../../templates/package/.github/workflows/publish.yml",
    import.meta.url,
  ),
  "utf8",
);
const block = workflow.split(
  "      - name: Wait for published registry metadata",
)[1];
const source = block
  .split("<<'NODE'\n")[1]
  .split("\n          NODE")[0]
  .split("\n")
  .map((l) => l.slice(10))
  .join("\n");
const run = new (Object.getPrototypeOf(async function () {}).constructor)(
  "process",
  "fetch",
  "setTimeout",
  "AbortSignal",
  "console",
  source,
);
const name = "@bitbaum/fixture",
  version = "1.2.3";
const complete = {
  versions: {
    [version]: {
      name,
      version,
      dist: {
        integrity: "sha512-fixture",
        tarball: "https://registry.npmjs.org/fixture.tgz",
      },
    },
  },
};
async function exercise(responses) {
  let reads = 0,
    waits = 0;
  const execute = run(
    { env: { NAME: name, VERSION: version } },
    async () => {
      const r = responses[Math.min(reads++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return { ok: r !== null, json: async () => r };
    },
    (fn) => {
      waits++;
      fn();
    },
    AbortSignal,
    { log() {} },
  );
  return { execute, counts: () => ({ reads, waits }) };
}
test("accepted publication waits through missing and incomplete metadata until the exact artifact exists", async () => {
  const t = await exercise([null, { versions: {} }, complete]);
  await t.execute;
  assert.deepEqual(t.counts(), { reads: 3, waits: 2 });
});
test("an immediately readable release adds no wait", async () => {
  const t = await exercise([complete]);
  await t.execute;
  assert.deepEqual(t.counts(), { reads: 1, waits: 0 });
});
test("a transient registry error can recover", async () => {
  const t = await exercise([new Error("transient"), complete]);
  await t.execute;
  assert.equal(t.counts().reads, 2);
});
test("missing metadata fails after bounded retries rather than reporting successful availability", async () => {
  const t = await exercise([null]);
  await assert.rejects(t.execute, /did not become ready/);
  assert.deepEqual(t.counts(), { reads: 60, waits: 59 });
});
test("the wrong package identity or missing integrity never establishes readiness", async () => {
  for (const record of [
    { name: "other", version, dist: { integrity: "x", tarball: "x" } },
    { name, version, dist: { tarball: "x" } },
  ]) {
    const t = await exercise([{ versions: { [version]: record } }]);
    await assert.rejects(t.execute, /did not become ready/);
  }
});
