import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { applicationDefault, initializeApp, getApps } from "firebase-admin/app";
import { trialGoogleStore } from "../../collector/trial-google";
import { createTrialRuntime } from "../../collector/trial-runtime";
import { stopTrialInfrastructure } from "../../collector/trial-shutdown";
import { createLiveRuntime } from "../../collector/allowance-live";
import { retiredMarketRoute } from '../../collector/routes';
import { getAuth } from "firebase-admin/auth";
import { cachedDashboard, measureDashboard, usageHandler } from "../../collector/usage-dashboard";
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { readPortfolioDemand } from '../../collector/portfolio-demand';
import { PORTFOLIO_COLLECTION_ENABLED } from '../../shared/companion/portfolio-policy';
import { MARKET_COLLECTION_SCHEDULE } from '../../shared/market-schedule';
import type { Holding } from '../../shared/companion/portfolio';
import type { TrialSession } from '../../collector/trial';

// Source implementation only: the deployment guard still requires verified
// preflight. Missing release deadlines or ledger always stop optional work.
const project = process.env.GCLOUD_PROJECT ?? "bazaarsignal-510305";
process.env.COLLECTOR_ALLOWED_ORIGINS ??= "https://bazaarsignal.web.app";
if (!getApps().length) initializeApp();
const credential = applicationDefault();
const token = async () => (await credential.getAccessToken()).access_token;
const ownerApp = initializeApp({ credential, projectId: 'bazaarsignal' }, 'usage-owner');
const usageStore = trialGoogleStore({ project, bucket: `${project}-market-cache`, token });
const ownerUsage = usageHandler({
  verify: idToken => getAuth(ownerApp).verifyIdToken(idToken, true),
  dashboard: cachedDashboard(usageStore, () => measureDashboard({ store: usageStore, token })),
});
const live = process.env.MARKET_OPERATING_MODE === "free-tier";
const portfolioDemand=(session:TrialSession)=>readPortfolioDemand({
  reserveReads:async count=>{await session.extend({firestoreReads:count});session.take({firestoreReads:count});},
  page:async(cursor,limit)=>{
    let query=getFirestore(ownerApp).collectionGroup('holdings').orderBy(FieldPath.documentId()).limit(limit);
    if(cursor)query=query.startAfter(getFirestore(ownerApp).doc(cursor));
    const page=await query.get();return {rows:page.docs.map(d=>({path:d.ref.path,holding:d.data() as Holding})),next:page.size===limit?page.docs[page.docs.length-1].ref.path:null};
  },
  portfolio:async path=>{const p=await getFirestore(ownerApp).doc(path).get();return p.exists?{deleted:p.data()?.deleted!==false}:null;},
});
const runtime = live ? createLiveRuntime({
  id: process.env.MARKET_LIVE_ID ?? "",
  expiresAt: Date.parse(process.env.MARKET_LIVE_END ?? ""),
  store: session => trialGoogleStore({ project, bucket: `${project}-market-cache`, token }, session),
  shutdown: () => stopTrialInfrastructure({ project, token }),
  report: measurement => console.info(JSON.stringify(measurement)),
  portfolioDemand,
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
  portfolioDemand,
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
  async (req, res) => {
    // Retired clients get a terminal response before allowance/storage admission.
    if (retiredMarketRoute(new URL(req.url,'http://localhost').pathname)) {
      res.setHeader('Cache-Control','public, max-age=3600');
      if(req.headers.origin==='https://bazaarsignal.web.app')res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
      res.status(410).json({error:'Discovery and seller lookups have retired. Reload BazaarSignal to open Portfolios.'});return;
    }
    // Route before market admission: dashboard reads can never collect, reserve market work or pause it.
    if (new URL(req.url, 'http://localhost').pathname.startsWith('/api/owner/')) {
      if (new URL(req.url, 'http://localhost').pathname === '/api/owner/usage') { await ownerUsage(req, res); return; }
      res.setHeader('Cache-Control', 'no-store'); res.status(404).json({error:'Not found.'}); return;
    }
    await runtime.handle(req, res);
  },
);
export const refreshMarket = onSchedule(
  {
    schedule: live ? MARKET_COLLECTION_SCHEDULE : "* * * * *",
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
  async event => {
    // Gate before all private scans, allowance I/O and upstream collection.
    if(!PORTFOLIO_COLLECTION_ENABLED){console.info('Portfolio collection remains paused.');return;}
    await runtime.collect(`${event.jobName}:${event.scheduleTime}`);
  },
);
