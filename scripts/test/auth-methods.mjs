import assert from "node:assert/strict";
import { otpForURI } from "./auth-totp.mjs";

async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return async () => {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  };
}

/** Synthetic account only. Never capture screens containing TOTP/backup credentials. */
export async function exerciseAuthMethod({
  scenario,
  page,
  base,
  signIn,
  account,
  email,
  password,
  userId,
  labels,
  emailLink,
}) {
  const section = (id) => page.locator(`section[aria-labelledby="${id}"]`);
  const currentSession = async () =>
    page.evaluate(async () =>
      (await fetch("/api/auth/get-session", { cache: "no-store" })).json(),
    );
  const accountReady = async () => {
    await page.waitForURL(base + account);
    await page.locator("#acct-display-name").waitFor();
    assert.ok(
      (await currentSession())?.user?.id === userId,
      "method preserves the original account identity",
    );
  };
  const logout = async () => {
    await section("acct-leave")
      .getByRole("button", { name: labels.account.signOut, exact: true })
      .click();
    await page.waitForURL((url) => url.pathname !== account);
    assert.ok(
      (await currentSession()) === null,
      "UI sign-out revokes the browser session",
    );
    const protectedPage = await page.request.get(base + account, {
      maxRedirects: 0,
    });
    assert.ok(
      protectedPage.status() >= 300 && protectedPage.status() < 400,
      "signed-out account page is protected",
    );
    assert.ok(
      protectedPage.headers().location?.includes(signIn),
      "signed-out account returns to sign-in",
    );
  };
  const passwordStep = async () => {
    await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page
      .locator("form")
      .filter({ has: page.locator('input[autocomplete="current-password"]') })
      .locator('button[type="submit"]')
      .click();
    await page.locator("#acct-code").waitFor();
    assert.ok(
      (await currentSession()) === null,
      "password alone cannot bypass the second factor",
    );
  };
  const submitCode = async (code) => {
    await page.locator("#acct-code").fill(code);
    await page
      .locator("form")
      .filter({ has: page.locator("#acct-code") })
      .locator('button[type="submit"]')
      .click();
  };

  if (scenario === "magic-link") {
    await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
    await page.locator('input[type="email"]').fill(email);
    const sent = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/sign-in/magic-link") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: labels.withLink, exact: true })
      .click();
    assert.equal(
      (await sent).status(),
      200,
      "magic link requested through shared UI",
    );
    const link = emailLink();
    assert.equal(
      link.origin,
      base,
      "captured magic link belongs to the isolated app",
    );
    await page.goto(link.href);
    await accountReady();
    await logout();
    await page.goto(link.href);
    assert.ok(
      (await currentSession()) === null,
      "a used magic link cannot authenticate again",
    );
    await page.locator('input[type="email"]').waitFor();
    assert.equal(
      await page.locator('input[autocomplete="new-password"]').count(),
      0,
      "expired sign-in links must not open password recovery",
    );
    return;
  }

  await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page
    .locator("form")
    .filter({ has: page.locator('input[autocomplete="current-password"]') })
    .locator('button[type="submit"]')
    .click();
  await accountReady();
  if (scenario === "passkeys") {
    const closeAuthenticator = await virtualAuthenticator(page);
    try {
      const enrolled = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            "/passkey/verify-registration",
          ) && response.request().method() === "POST",
      );
      await section("acct-passkeys")
        .getByRole("button", { name: labels.account.addPasskey, exact: true })
        .click();
      assert.equal(
        (await enrolled).status(),
        200,
        "virtual passkey enrollment verifies on the real server",
      );
      await section("acct-passkeys").locator("li").first().waitFor();
      await logout();
      await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
      await page
        .getByRole("button", { name: labels.withPasskey, exact: true })
        .click();
      await accountReady();
      const removed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            "/passkey/delete-passkey",
          ) && response.request().method() === "POST",
      );
      await section("acct-passkeys")
        .getByRole("button", { name: labels.account.remove, exact: true })
        .click();
      assert.equal((await removed).status(), 200, "passkey removal succeeds");
      await section("acct-passkeys")
        .locator("li")
        .waitFor({ state: "detached" });
      await logout();
    } finally {
      await closeAuthenticator();
    }
    return;
  }

  assert.ok(
    [
      "two-factor",
      "two-factor-disable",
      "two-factor-magic-link",
      "two-factor-passkeys",
    ].includes(scenario),
  );
  const factor = section("acct-two-factor");
  await page.locator("#acct-current-password").fill(password);
  await factor
    .getByRole("button", { name: labels.account.setUp, exact: true })
    .click();
  const setup = factor.locator('a[href^="otpauth:"]');
  await setup.waitFor();
  const uri = await setup.getAttribute("href");
  const backups = await factor.locator("code").allTextContents();
  assert.ok(backups.length >= 2, "setup provides independent recovery codes");
  await page.locator("#acct-totp").fill(otpForURI(uri));
  await factor.locator("form").locator('button[type="submit"]').click();
  await factor
    .getByRole("button", { name: labels.account.turnOff, exact: true })
    .waitFor();
  if (scenario === "two-factor-passkeys") {
    const closeAuthenticator = await virtualAuthenticator(page);
    try {
      const enrolled = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            "/passkey/verify-registration",
          ) && response.request().method() === "POST",
      );
      await section("acct-passkeys")
        .getByRole("button", { name: labels.account.addPasskey, exact: true })
        .click();
      assert.equal((await enrolled).status(), 200);
      await section("acct-passkeys").locator("li").first().waitFor();
      await logout();
      await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
      await page
        .getByRole("button", { name: labels.withPasskey, exact: true })
        .click();
      await page.locator("#acct-code").waitFor();
      assert.ok(
        (await currentSession()) === null,
        "a passkey cannot skip an explicitly enabled authenticator factor",
      );
      await submitCode(otpForURI(uri));
      await accountReady();
      await logout();
    } finally {
      await closeAuthenticator();
    }
    return;
  }
  if (scenario === "two-factor-magic-link") {
    await logout();
    await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
    await page.locator('input[type="email"]').fill(email);
    const sent = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/sign-in/magic-link") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: labels.withLink, exact: true })
      .click();
    assert.equal((await sent).status(), 200);
    const link = emailLink();
    assert.equal(link.origin, base);
    await page.goto(link.href);
    assert.ok(
      (await currentSession()) === null,
      "an email link must not bypass enabled two-factor authentication",
    );
    await page.locator("#acct-code").waitFor();
    await submitCode(otpForURI(uri));
    await accountReady();
    await logout();
    return;
  }
  if (scenario === "two-factor-disable") {
    await page.locator("#acct-current-password").fill(password);
    await factor
      .getByRole("button", { name: labels.account.turnOff, exact: true })
      .click();
    await factor
      .getByRole("button", { name: labels.account.setUp, exact: true })
      .waitFor();
    await logout();
    await page.goto(base + signIn + "?next=" + encodeURIComponent(account));
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page
      .locator("form")
      .filter({ has: page.locator('input[autocomplete="current-password"]') })
      .locator('button[type="submit"]')
      .click();
    await accountReady();
    await logout();
    return;
  }
  await logout();
  await passwordStep();
  await submitCode(otpForURI(uri));
  await accountReady();
  await logout();
  await passwordStep();
  await page
    .getByRole("button", { name: labels.useBackup, exact: true })
    .click();
  await submitCode(backups[0]);
  await accountReady();
  await logout();
  await passwordStep();
  await page
    .getByRole("button", { name: labels.useBackup, exact: true })
    .click();
  await submitCode(backups[0]);
  await page.getByRole("alert").waitFor();
  assert.ok(
    (await currentSession()) === null,
    "a consumed backup code cannot authenticate again",
  );
  await submitCode(backups[1]);
  await accountReady();
  await logout();
}
