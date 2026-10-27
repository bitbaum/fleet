import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { receiptMatches } from "./release-receipt-contract.mjs";

/** Verify the complete staged artifact contract against what the app serves. */
export async function verifyLiveReceipt(url, expected, fetchReceipt = fetch) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("Live release receipts require credential-free HTTPS");
  target.searchParams.set("fleet_commit", expected.commit);
  const response = await fetchReceipt(target, {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Live release receipt returned HTTP ${response.status}`);
  const receipt = await response.json();
  if (!receiptMatches(receipt, expected))
    throw new Error("Live release receipt does not match the staged release");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = key => {
    const at = process.argv.indexOf(key);
    if (at < 0 || !process.argv[at + 1]) throw new Error(`Missing ${key}`);
    return process.argv[at + 1];
  };
  const expected = JSON.parse(readFileSync(option("--expected"), "utf8"));
  const receipt = await verifyLiveReceipt(option("--url"), expected);
  console.log(`Verified live release receipt: ${receipt.repo} ${receipt.commit}`);
}
