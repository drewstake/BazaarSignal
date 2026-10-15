// Read-only, bounded discovery for the actual-cost pause migration.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw Error('Owner login missing');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  const project = 'bazaarsignal-510305';
  const endpoints = {
    budgets: 'https://billingbudgets.googleapis.com/v1/billingAccounts/012803-EA91BE-8DCD32/budgets?pageSize=100',
    topics: `https://pubsub.googleapis.com/v1/projects/${project}/topics?pageSize=100`,
    subscriptions: `https://pubsub.googleapis.com/v1/projects/${project}/subscriptions?pageSize=100`,
    mainProject: 'https://cloudresourcemanager.googleapis.com/v1/projects/bazaarsignal',
    marketProject: `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`,
    mainBilling: 'https://cloudbilling.googleapis.com/v1/projects/bazaarsignal/billingInfo',
    marketBilling: `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,
    paid: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`,
  };
  const report = { at: new Date().toISOString(), resources: {} };
  for (const [key, url] of Object.entries(endpoints)) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    report.resources[key] = { status: r.status, data };
  }
  fs.writeFileSync('.local/actual-billing-inspection.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.resources).map(([k,v]) => [k, k === 'paid' && v.status === 200 ? {
    status: v.status, ...(({ reservedUsd, stoppedAt, expiresAt }) => ({reservedUsd, stoppedAt, expiresAt}))(JSON.parse(v.data.fields.value.stringValue))
  } : v])), null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
