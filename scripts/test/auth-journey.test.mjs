import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the account journey refuses deployed targets before starting anything", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./auth-journey.mjs", import.meta.url))],
    {
      env: { ...process.env, AUTH_TEST_BASE_URL: "https://production.example" },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only target a local test app/);
});

test("test mail capture cannot run with real credentials", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./capture-auth-mail.mjs", import.meta.url)),
      "-e",
      "",
    ],
    {
      env: {
        ...process.env,
        FLEET_AUTH_TEST_MAIL_PORT: "54321",
        RESEND_API_KEY: "a-real-key-is-not-allowed",
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /synthetic key/);
});
