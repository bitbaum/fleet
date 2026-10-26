import assert from "node:assert/strict";
import { checkAuthIntegration } from "./auth-integration.mjs";
import { authChromium } from "./auth-browser.mjs";
import { exerciseAuthMethod } from "./auth-methods.mjs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, createWriteStream } from "node:fs";

const base = process.env.AUTH_TEST_BASE_URL ?? "http://localhost:3000";
const origin = new URL(base);
assert.ok(
  ["localhost", "127.0.0.1"].includes(origin.hostname),
  "Journey may only target a local test app",
);
const scenario = process.env.AUTH_TEST_SCENARIO ?? "recovery";
assert.ok(
  [
    "recovery",
    "passkeys",
    "two-factor",
    "two-factor-disable",
    "two-factor-magic-link",
    "two-factor-passkeys",
    "magic-link",
  ].includes(scenario),
  "Unknown account test scenario",
);
const signIn = process.env.AUTH_TEST_SIGNIN_PATH ?? "/sign-in";
const account = process.env.AUTH_TEST_ACCOUNT_PATH ?? "/account";
const out = resolve(
  process.env.AUTH_TEST_ARTIFACTS ?? "auth-journey-artifacts",
  scenario,
);
mkdirSync(out, { recursive: true });
const messages = [];
const outbox = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/messages") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  messages.push(JSON.parse(body));
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ id: `test-${messages.length}` }));
});
await new Promise((done) => outbox.listen(0, "127.0.0.1", done));
const serverLog = createWriteStream(resolve(out, "server.log"));
const child = spawn(
  "pnpm",
  ["run", "start", "--hostname", "127.0.0.1", "--port", origin.port || "3000"],
  {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: base,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
      RESEND_API_KEY: "re_fleet_test_" + randomBytes(24).toString("hex"),
      FLEET_AUTH_TEST_MAIL_PORT: String(outbox.address().port),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${fileURLToPath(new URL("./capture-auth-mail.mjs", import.meta.url))}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.pipe(serverLog);
child.stderr.pipe(serverLog);
const cookies = new Map();
async function call(path, body, useCookies = true) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(useCookies
        ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0],
      separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}
const post = (path, body, useCookies) =>
  call("/api/auth" + path, body, useCookies);
const session = () => call("/api/auth/get-session").then((r) => r.json());
const emailLink = () => {
  const message = messages.at(-1);
  assert.ok(message, "App must send account mail through its actual adapter");
  const link = message.text.match(/https?:\/\/[^\s<>]+/)?.[0];
  assert.equal(
    new URL(link).origin,
    base,
    "Account links must use the configured origin",
  );
  return new URL(link);
};
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error("Test app exited; see server.log");
    try {
      if ((await fetch(base + signIn)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, "Test app must become ready");
  const email = `journey-${randomBytes(6).toString("hex")}@example.test`;
  const password = "an isolated initial test passphrase";
  const signedUp = await post("/sign-up/email", {
    email,
    password,
    name: "Journey",
    role: "admin",
    callbackURL: account,
  });
  assert.equal(signedUp.status, 200, "registration");
  assert.ok(messages.length, "verification message captured");
  const verify = emailLink();
  await call(verify.pathname + verify.search);
  const signedIn = await session();
  assert.ok(signedIn?.user?.id, "verification signs in");
  assert.notEqual(
    signedIn.user.role,
    "admin",
    "registration cannot grant admin",
  );
  const consumerRequire = createRequire(resolve("package.json"));
  const { authLabelsFor } = await import(
    consumerRequire.resolve("@bitbaum/accountkit/auth")
  );
  const labels = authLabelsFor(signIn.split("/").filter(Boolean)[0]);
  if (scenario === "recovery" && process.env.AUTH_TEST_INTEGRATION_CHECK) {
    browser = await authChromium(consumerRequire).launch({
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext();
      const login = await context.request.post(base + "/api/auth/sign-in/email", {
        headers: { origin: base },
        data: { email, password },
      });
      assert.equal(login.status(), 200, "product integration browser signs in normally");
      const page = await context.newPage();
      await checkAuthIntegration(process.env.AUTH_TEST_INTEGRATION_CHECK, { page, base, userId: signedIn.user.id });
    } finally {
      await browser.close();
      browser = null;
    }
  }

  if (scenario !== "recovery") {
    const chromium = authChromium(consumerRequire);
    browser = await chromium.launch({
      ...(process.env.BROWSER_EXECUTABLE
        ? { executablePath: process.env.BROWSER_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await exerciseAuthMethod({
      scenario,
      page,
      base,
      signIn,
      account,
      email,
      password,
      userId: signedIn.user.id,
      labels,
      emailLink,
    });
    await post("/sign-out", {});
    console.log(
      `PASS real app ${scenario} lifecycle, preserved identity and UI sign-out`,
    );
  } else {
    const absent = await post("/request-password-reset", {
      email: "absent@example.test",
      redirectTo: base + signIn + "?next=" + encodeURIComponent(account),
    });
    const present = await post("/request-password-reset", {
      email,
      redirectTo: base + signIn + "?next=" + encodeURIComponent(account),
    });
    assert.equal(present.status, 200);
    assert.deepEqual(
      await present.json(),
      await absent.json(),
      "recovery must not enumerate accounts",
    );
    const resetLink = emailLink();
    const callback = await call(resetLink.pathname + resetLink.search);
    const redirect = new URL(callback.headers.get("location"));
    assert.equal(redirect.pathname, signIn);
    assert.equal(redirect.searchParams.get("next"), account);
    const token = redirect.searchParams.get("token");
    const require = createRequire(resolve("package.json"));
    const chromium = authChromium(require);
    browser = await chromium.launch({
      ...(process.env.BROWSER_EXECUTABLE
        ? { executablePath: process.env.BROWSER_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(redirect.href);
    const inputs = page.locator('input[type="password"]');
    // SSR initially draws the ordinary sign-in form; hydration reads and clears
    // the reset token before rendering the two password fields.
    await inputs.nth(1).waitFor();
    assert.equal(
      await inputs.count(),
      2,
      "real app renders the shared reset form",
    );
    await inputs.nth(0).fill("a replacement isolated test passphrase");
    await inputs.nth(1).fill("a replacement isolated test passphrase");
    assert.ok(
      !new URL(page.url()).searchParams.has("token"),
      "token removed from address bar",
    );
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `reset overflow at ${width}`,
        );
        await page.screenshot({
          path: resolve(out, `reset-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    }
    await page
      .locator("form")
      .filter({ has: page.locator('input[autocomplete="new-password"]') })
      .locator('button[type="submit"]')
      .click();
    await page.getByRole("status").waitFor();
    assert.ok((await session()) === null, "reset revokes old sessions");
    assert.equal(
      (
        await post("/reset-password", {
          token,
          newPassword: "another isolated passphrase",
        })
      ).status,
      400,
      "token is one-time",
    );
    assert.equal(
      (await post("/sign-in/email", { email, password })).status,
      401,
      "old password rejected",
    );
    assert.equal(
      (
        await post("/sign-in/email", {
          email,
          password: "a replacement isolated test passphrase",
        })
      ).status,
      200,
      "new password works",
    );
    assert.equal(
      (await session()).user.id,
      signedIn.user.id,
      "identity is preserved",
    );
    await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
    await page.locator('input[type="email"]').fill(email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill("a replacement isolated test passphrase");
    await page
      .locator("form")
      .filter({ has: page.locator('input[autocomplete="current-password"]') })
      .locator('button[type="submit"]')
      .click();
    await page.waitForURL(base + account);
    await page.locator("#acct-display-name").waitFor();
    assert.equal(
      await page.locator("#acct-display-name").inputValue(),
      "Journey",
      "server page and API recognize the same person",
    );
    await page
      .locator('section[aria-labelledby="acct-leave"]')
      .getByRole("button", { name: labels.account.signOut, exact: true })
      .click();
    await page.waitForURL((url) => url.pathname !== account);
    assert.equal(
      await page.evaluate(async () =>
        (await fetch("/api/auth/get-session", { cache: "no-store" })).json(),
      ),
      null,
      "browser UI sign-out revokes the browser session",
    );
    assert.equal((await post("/sign-out", {})).status, 200);
    assert.ok((await session()) === null);
    console.log(
      "PASS real app registration, verification, password recovery, browser reset, session revocation and sign-out",
    );
  }
} finally {
  if (browser) await browser.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  if (child.exitCode === null)
    await new Promise((done) => {
      const deadline = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* exited */
        }
        done();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(deadline);
        done();
      });
    });
  child.stdout.unpipe(serverLog);
  child.stderr.unpipe(serverLog);
  outbox.close();
  serverLog.end();
}
