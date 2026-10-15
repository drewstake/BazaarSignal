// Bounded operator verification of the same feed consumed hourly in production.
// Never invokes collection, resets a stop, or substitutes console values for a feed.
import { createRequire } from 'node:module';
import { trialGoogleStore } from '../collector/trial-google';
import { PaidLedger, PAID_BUDGET_KEY, type PaidBudget } from '../collector/paid-budget';
import { googleBillingFeed } from '../collector/paid-billing';
import { stopTrialInfrastructure } from '../collector/trial-shutdown';
const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
const owner = auth.getAllAccounts().find((a: any) => a.user.email === 'drewstake3@gmail.com');
if (!owner) throw Error('Owner login missing');
const token = async () => (await auth.getAccessToken(owner.tokens.refresh_token, [])).access_token;
const project = 'bazaarsignal-510305';
const store = trialGoogleStore({project, bucket: `${project}-market-cache`, token});
try {
  const before: PaidBudget = JSON.parse((await store.read(PAID_BUDGET_KEY)) ?? 'null');
  if (!before?.billing || Date.now() >= before.expiresAt) throw Error('Active billing feed not configured');
  const feed = googleBillingFeed(token);
  await new PaidLedger(store).refreshBilling(async (...args) => {
    try { await feed(...args); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Spending check failed'); throw error; }
  });
  const after: PaidBudget = JSON.parse((await store.read(PAID_BUDGET_KEY))!);
  if (after.stoppedAt !== undefined) await stopTrialInfrastructure({project, token});
  console.log(JSON.stringify({ basis: after.billing?.latest ? 'google-reported-net-spending' : 'pending-first-notification',
    billing: after.billing, reservedUsd: after.reservedUsd, stoppedAt: after.stoppedAt, reason: after.reason }, null, 2));
} finally { await store.close(); }
