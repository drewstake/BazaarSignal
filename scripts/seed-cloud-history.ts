import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  CloudPriceHistory,
  decodeHistory,
} from "../collector/cloud-price-history";
import { validatePaid, type PaidBudget } from "../collector/paid-budget";
const apply = process.argv.includes("--apply");
const auth = createRequire(import.meta.url)("firebase-tools/lib/auth");
const account = auth
  .getAllAccounts()
  .find((a: any) => a.user.email === "drewstake3@gmail.com");
if (!account) throw Error("Deployment account unavailable");
const token = async () =>
  (await auth.getAccessToken(account.tokens.refresh_token, []))
    .access_token as string;
const project = "bazaarsignal-510305";
const seed = JSON.parse(readFileSync(".local/cloud-history/seed.json", "utf8"));
if (
  seed.sha256 !==
    createHash("sha256").update(JSON.stringify(seed.documents)).digest("hex") ||
  seed.documents.length > 448
)
  throw Error("Seed verification failed");
const budgetResponse = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`,
  {
    headers: { Authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(15000),
  },
);
if (!budgetResponse.ok) throw Error("Budget unavailable");
const ledger: PaidBudget & { deployments?: Record<string, unknown> } =
  JSON.parse((await budgetResponse.json()).fields.value.stringValue);
validatePaid(ledger, Date.now());
if (apply && !ledger.deployments?.["daily-history-oct19"])
  throw Error(
    "Deploy the reviewed release with its $0.50 import/rollout reservation first",
  );
const store = new CloudPriceHistory({ project, token });
const metaDoc = (await store.read(["meta"])).get("meta")!;
if (metaDoc.value)
  throw Error("Cloud archive already initialized; refusing to replace it");
let verified = 0,
  written = 0;
for (let offset = 0; offset < seed.documents.length; offset += 32) {
  const batch = seed.documents.slice(offset, offset + 32);
  const current = await store.read(batch.map((r: any) => r.id));
  const missing = [];
  for (const row of batch) {
    const prior = current.get(row.id)!;
    const value = decodeHistory(row.packed);
    if (prior.value) {
      if (JSON.stringify(prior.value) !== JSON.stringify(value))
        throw Error(`Cloud seed collision: ${row.id}`);
      verified++;
    } else missing.push({ id: row.id, value });
  }
  if (apply) {
    await store.write(missing);
    written += missing.length;
  }
}
if (apply) {
  // Publish the manifest only after every seed document has been uploaded.
  await store.write([
    {
      id: "meta",
      value: {
        version: 1,
        years: seed.years,
        lastSuccess: null,
        seedSha256: seed.sha256,
      },
    },
  ]);
  const check = await store.item(
    "BOOSTER_COOKIE",
    Date.now(),
    ledger.expiresAt,
  );
  if (check.points.length < 180) throw Error("Seed readback is incomplete");
}
const report = {
  at: new Date().toISOString(),
  apply,
  sha256: seed.sha256,
  verified,
  written,
  project,
  source: "Skytrack + Bazaar Calc",
  chargedWithin: "daily-history-oct19 rollout reserve",
};
writeFileSync(
  `.local/cloud-history/seed-${apply ? "apply" : "inspect"}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
