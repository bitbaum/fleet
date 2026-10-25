// Loaded only by the isolated auth journey, never by a deployed application.
const port = Number(process.env.FLEET_AUTH_TEST_MAIL_PORT);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  !process.env.RESEND_API_KEY?.startsWith("re_fleet_test_")
)
  throw new Error(
    "The auth test transport requires an isolated outbox and a synthetic key",
  );
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === "https://api.resend.com/emails")
    return original(`http://127.0.0.1:${port}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: init?.body,
    });
  return original(input, init);
};
