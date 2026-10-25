import { createHmac } from "node:crypto";

/** RFC 6238 test driver; secrets stay in memory and are never emitted as evidence. */
export function otpForURI(uri, now = Date.now()) {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:" || url.hostname !== "totp")
    throw new Error("Expected a TOTP setup URI");
  const secret =
    url.searchParams.get("secret")?.toUpperCase().replace(/=+$/, "") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const char of secret) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid test TOTP secret encoding");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  if (!bytes.length) throw new Error("Missing test TOTP secret");
  const digits = Number(url.searchParams.get("digits") ?? 6);
  const period = Number(url.searchParams.get("period") ?? 30);
  const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  if (
    ![6, 7, 8].includes(digits) ||
    !Number.isInteger(period) ||
    period < 1 ||
    !["sha1", "sha256", "sha512"].includes(algorithm)
  )
    throw new Error("Unsupported test TOTP parameters");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const digest = createHmac(algorithm, Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
