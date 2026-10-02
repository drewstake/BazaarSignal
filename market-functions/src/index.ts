import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { applicationDefault, initializeApp, getApps } from "firebase-admin/app";
import { trialGoogleStore } from "../../collector/trial-google";
import { createTrialRuntime } from "../../collector/trial-runtime";
import { stopTrialInfrastructure } from "../../collector/trial-shutdown";
import { createLiveRuntime } from "../../collector/allowance-live";

// Source implementation only: the deployment guard still requires verified
// preflight. Missing release deadlines or ledger always stop optional work.
const project = process.env.GCLOUD_PROJECT ?? "bazaarsignal-510305";
process.env.COLLECTOR_ALLOWED_ORIGINS ??= "https://bazaarsignal.web.app";
if (!getApps().length) initializeApp();
const credential = applicationDefault();
const token = async () => (await credential.getAccessToken()).access_token;
const live = process.env.MARKET_OPERATING_MODE === "free-tier";
const runtime = live ? createLiveRuntime({
  id: process.env.MARKET_LIVE_ID ?? "",
  expiresAt: Date.parse(process.env.MARKET_LIVE_END ?? ""),
  store: session => trialGoogleStore({ project, bucket: `${project}-market-cache`, token }, session),
  shutdown: () => stopTrialInfrastructure({ project, token }),
  report: measurement => console.info(JSON.stringify(measurement)),
}) : createTrialRuntime({
  trialId: process.env.MARKET_TRIAL_ID ?? "",
  startsAt: Date.parse(process.env.MARKET_TRIAL_START ?? ""),
  expiresAt: Date.parse(process.env.MARKET_TRIAL_END ?? ""),
  store: (session, onAttempt) =>
    trialGoogleStore(
      { project, bucket: `${project}-market-cache`, token, onAttempt },
      session,
    ),
  shutdown: () => stopTrialInfrastructure({ project, token }),
  report: (measurement) => console.info(JSON.stringify(measurement)),
});
export const marketApi = onRequest(
  {
    region: "us-central1",
    memory: "1GiB",
    cpu: 1,
    minInstances: 0,
    maxInstances: 1,
    concurrency: 2,
    timeoutSeconds: live ? 15 : 30,
    invoker: "private",
    serviceAccount: `market-reader@${project}.iam.gserviceaccount.com`,
  },
  async (req, res) => runtime.handle(req, res),
);
export const refreshMarket = onSchedule(
  {
    schedule: live ? "0 * * * *" : "* * * * *",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "1GiB",
    cpu: 1,
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: live ? 90 : 180,
    retryCount: 0,
    serviceAccount: `market-collector@${project}.iam.gserviceaccount.com`,
  },
  async (event) => runtime.collect(`${event.jobName}:${event.scheduleTime}`),
);
