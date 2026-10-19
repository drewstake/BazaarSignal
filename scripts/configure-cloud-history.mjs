import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const apply = process.argv.includes("--apply");
const auth = createRequire(import.meta.url)("firebase-tools/lib/auth");
const account = auth
  .getAllAccounts()
  .find((a) => a.user.email === "drewstake3@gmail.com");
if (!account) throw Error("Deployment account unavailable");
const token = (await auth.getAccessToken(account.tokens.refresh_token, []))
  .access_token;
const project = "bazaarsignal-510305",
  root = `projects/${project}/locations/us-central1`,
  base = `https://cloudscheduler.googleapis.com/v1/${root}/jobs`;
async function call(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (text.length > 1024 ** 2) throw Error("Response exceeds bound");
  const value = text ? JSON.parse(text) : {};
  if (!r.ok && r.status !== 404)
    throw Error(`Cloud configuration HTTP ${r.status}: ${value.error?.status}`);
  return { status: r.status, value };
}
const budget = (
  await call(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`,
  )
).value;
const ledger = JSON.parse(budget.fields.value.stringValue);
if (
  ledger.id !== "paid-202610" ||
  ledger.stopUsd !== 4.5 ||
  ledger.limitUsd !== 5 ||
  ledger.stoppedAt ||
  Date.now() >= ledger.expiresAt ||
  !ledger.deployments?.["daily-history-oct19"] ||
  ledger.billing?.latest?.actualUsd >= 4.5
)
  throw Error("Active reserved cloud allowance required");
const existing = (
  await call(`${base}/firebase-schedule-refreshMarket-us-central1`)
).value;
if (
  existing.state !== "ENABLED" ||
  existing.schedule !== "0 * * * *" ||
  existing.httpTarget?.uri !==
    "https://refreshmarket-k5a64sgi2q-uc.a.run.app/" ||
  existing.httpTarget.oidcToken?.serviceAccountEmail !==
    `market-collector@${project}.iam.gserviceaccount.com`
)
  throw Error("Unexpected existing collector schedule");
const desired = {
  name: `${root}/jobs/bazaar-daily-close`,
  description:
    "BazaarSignal daily closing prices; same paid budget and fixed pilot expiry as the hourly collector.",
  schedule: "59 4 * * *",
  timeZone: "Etc/UTC",
  httpTarget: existing.httpTarget,
  retryConfig: { retryCount: 0 },
  attemptDeadline: "90s",
};
let result = await call(`${base}/bazaar-daily-close`);
if (result.status !== 404) {
  if (
    result.value.schedule !== desired.schedule ||
    result.value.timeZone !== desired.timeZone ||
    JSON.stringify(result.value.httpTarget) !==
      JSON.stringify(desired.httpTarget)
  )
    throw Error("Existing daily schedule differs; refusing to overwrite");
} else if (apply) result = await call(base, "POST", desired);
if (apply && result.value.state !== "ENABLED")
  throw Error("Daily schedule is not enabled");
const report = {
  at: new Date().toISOString(),
  apply,
  desired,
  state: result.value.state ?? "not-created",
  expiresAt: new Date(ledger.expiresAt).toISOString(),
};
writeFileSync(
  `.local/cloud-history/schedule-${apply ? "apply" : "inspect"}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
