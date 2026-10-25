import { test } from "node:test";
import assert from "node:assert/strict";
import { otpForURI } from "./auth-totp.mjs";
const uri =
  "otpauth://totp/fixture?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8";
test("TOTP driver matches independent RFC 6238 SHA1 vectors", () => {
  for (const [seconds, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])
    assert.equal(otpForURI(uri, seconds * 1000), code);
});
test("TOTP driver rejects invalid setup without echoing a secret", () => {
  for (const invalid of [
    "https://example.test",
    "otpauth://totp/test?secret=INVALID!",
    uri + "&algorithm=MD5",
  ])
    assert.throws(() => otpForURI(invalid));
});
