// Optional read-only evidence capture. Never invokes either market handler.
const fs = require("node:fs");
const auth = require("firebase-tools/lib/auth");
(async () => {
  const account = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Existing authorized operator login required");
  const token = (await auth.getAccessToken(account.tokens.refresh_token, []))
    .access_token;
  const root =
    "https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/";
  async function get(url) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Evidence read failed: HTTP ${r.status}`);
    return r.json();
  }
  const [ledger, control, job, bucket] = await Promise.all([
    get(root + "live-allowance"),
    get(root + "control"),
    get(
      "https://cloudscheduler.googleapis.com/v1/projects/bazaarsignal-510305/locations/us-central1/jobs/firebase-schedule-refreshMarket-us-central1",
    ),
    get(
      "https://storage.googleapis.com/storage/v1/b/bazaarsignal-510305-market-cache?fields=location,versioning,softDeletePolicy",
    ),
  ]);
  const result = {
    at: new Date().toISOString(),
    auditOperations: {
      firestoreDocumentReads: 2,
      schedulerGets: 1,
      bucketMetadataGets: 1,
    },
    ledger: JSON.parse(ledger.fields.value.stringValue),
    control: JSON.parse(control.fields.value.stringValue),
    job: {
      state: job.state,
      schedule: job.schedule,
      lastAttemptTime: job.lastAttemptTime,
      status: job.status,
    },
    bucket,
  };
  fs.mkdirSync(".local/market-audit", { recursive: true });
  fs.writeFileSync(
    ".local/market-audit/state.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      { at: result.at, job: result.job, bucket, ledger: result.ledger },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
