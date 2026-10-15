// Explicit actual-cost migration. Preparation does not alter admission policy.
// Activation requires both deployed handlers to match the verified local image.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [action, receiptPath] = process.argv.slice(2);
if (!['--prepare', '--activate', '--inspect'].includes(action)) throw Error('Use --prepare, --inspect, or --activate <image receipt>');
const project = 'bazaarsignal-510305', accountId = '012803-EA91BE-8DCD32';
const topic = `projects/${project}/topics/bazaar-paid-spend-october`;
const subscription = `projects/${project}/subscriptions/bazaar-paid-spend-october`;
const budgetRoot = `https://billingbudgets.googleapis.com/v1/billingAccounts/${accountId}/budgets`;
const displayName = 'BazaarSignal October 2026 net spending';
const desired = {
  displayName,
  budgetFilter: { projects: ['projects/1081657730748'], creditTypesTreatment: 'INCLUDE_ALL_CREDITS',
    customPeriod: { startDate: { year: 2026, month: 10, day: 1 }, endDate: { year: 2026, month: 11, day: 1 } } },
  amount: { specifiedAmount: { currencyCode: 'USD', units: '5' } },
  notificationsRule: { pubsubTopic: topic, schemaVersion: '1.0', disableDefaultIamRecipients: true },
};
const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
const owner = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
if (!owner) throw Error('Owner login missing');
const token = (await auth.getAccessToken(owner.tokens.refresh_token, [])).access_token;
const receipt = { at: new Date().toISOString(), action, changes: [], calls: 0 };
const output = `.local/actual-billing-${Date.now()}.json`;
const save = () => writeFileSync(output, JSON.stringify(receipt, null, 2));
async function request(url, method = 'GET', body, allow = []) {
  if (++receipt.calls > 45) throw Error('Billing setup call bound');
  receipt.lastRequest = { method, url }; save();
  const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(method === 'PUT' ? 120000 : 15000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json();
  if (!r.ok && !allow.includes(r.status)) throw Error(`Billing setup HTTP ${r.status}: ${data.error?.message}`);
  return { status: r.status, data };
}
const json = async (...args) => (await request(...args)).data;
function verifyBudget(b) {
  const f = b.budgetFilter, n = b.notificationsRule, m = b.amount?.specifiedAmount;
  if (!b.name?.startsWith(`billingAccounts/${accountId}/budgets/`) || b.displayName !== displayName ||
      JSON.stringify(f.projects) !== JSON.stringify(desired.budgetFilter.projects) ||
      f.creditTypesTreatment !== 'INCLUDE_ALL_CREDITS' ||
      JSON.stringify(f.customPeriod) !== JSON.stringify(desired.budgetFilter.customPeriod) ||
      f.services?.length || f.labels && Object.keys(f.labels).length || f.resourceAncestors?.length || f.subaccounts?.length ||
      f.creditTypes?.length || f.calendarPeriod || b.spendCap || b.thresholdRules?.length ||
      m?.currencyCode !== 'USD' || Number(m.units) !== 5 || (m.nanos ?? 0) !== 0 ||
      n?.pubsubTopic !== topic || n.schemaVersion !== '1.0' || n.disableDefaultIamRecipients !== true)
    throw Error('Existing billing budget differs; refusing overwrite');
}
try {
  if (action === '--prepare') {
    const service = await json(`https://serviceusage.googleapis.com/v1/projects/${project}/services/billingbudgets.googleapis.com`);
    if (service.state !== 'ENABLED') {
      const op = await json(`https://serviceusage.googleapis.com/v1/projects/${project}/services/billingbudgets.googleapis.com:enable`, 'POST', {});
      receipt.changes.push('Enabled Cloud Billing Budget API on the existing market project'); save();
      let status = op;
      for (let i = 0; !status.done && i < 6; i++) {
        await new Promise(r => setTimeout(r, 3000));
        status = await json(`https://serviceusage.googleapis.com/v1/${op.name}`);
      }
      if (!status.done || status.error) throw Error('Budget API enablement pending or failed');
    }
    const t = await request(`https://pubsub.googleapis.com/v1/${topic}`, 'GET', undefined, [404]);
    if (t.status === 404) { await json(`https://pubsub.googleapis.com/v1/${topic}`, 'PUT', {}); receipt.changes.push('Created billing notification topic'); }
    const s = await request(`https://pubsub.googleapis.com/v1/${subscription}`, 'GET', undefined, [404]);
    if (s.status === 404) {
      await json(`https://pubsub.googleapis.com/v1/${subscription}`, 'PUT', { topic, ackDeadlineSeconds: 60, messageRetentionDuration: '86400s', expirationPolicy: { ttl: '86400s' } });
      receipt.changes.push('Created bounded pull subscription');
    } else if (s.data.topic !== topic || s.data.pushConfig?.pushEndpoint) throw Error('Unexpected existing subscription');
    const policyUrl = `https://pubsub.googleapis.com/v1/${subscription}`;
    const policy = await json(`${policyUrl}:getIamPolicy`);
    const member = `serviceAccount:market-collector@${project}.iam.gserviceaccount.com`;
    if (!(policy.bindings ?? []).some(b => b.role === 'roles/pubsub.subscriber' && b.members.includes(member))) {
      policy.bindings ??= []; policy.bindings.push({ role: 'roles/pubsub.subscriber', members: [member] });
      await json(`${policyUrl}:setIamPolicy`, 'POST', { policy });
      receipt.changes.push('Granted existing collector consume access on this subscription only');
    }
  }
  const list = await json(`${budgetRoot}?pageSize=100`);
  if (list.nextPageToken) throw Error('Budget inventory exceeds inspection bound');
  const matches = (list.budgets ?? []).filter(b => b.displayName === displayName);
  if (matches.length > 1) throw Error('Ambiguous existing budget');
  let budget = matches[0];
  if (!budget && action === '--prepare') {
    budget = await json(budgetRoot, 'POST', desired);
    receipt.changes.push('Created fixed October net-cost budget with all credits included; no email recipients');
  }
  if (!budget) throw Error('Prepare the billing feed first');
  verifyBudget(budget);
  receipt.budget = budget;
  const sub = await json(`https://pubsub.googleapis.com/v1/${subscription}`);
  if (sub.topic !== topic || sub.pushConfig?.pushEndpoint) throw Error('Subscription changed');
  const publisher = await json(`https://pubsub.googleapis.com/v1/${topic}:getIamPolicy`);
  receipt.publisherPolicy = publisher;
  if (!(publisher.bindings ?? []).some(b => b.role === 'roles/pubsub.publisher' && b.members?.includes('serviceAccount:billing-budget-alert@system.gserviceaccount.com')))
    throw Error('Google Billing publisher grant missing');
  const billing = { accountId, budgetId: budget.name.split('/').at(-1), subscription,
    scope: 'BazaarSignal market project · all services · after credits', intervalStart: Date.parse('2026-10-01T07:00:00Z') };
  receipt.config = billing;
  if (action === '--activate') {
    if (!receiptPath) throw Error('Pass the verified image receipt');
    const image = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!image.localRuntimeSmokeVerified || !/^sha256:[a-f0-9]{64}$/.test(image.imageDigest)) throw Error('Image is not verified');
    for (const name of ['marketapi', 'refreshmarket']) {
      const service = await json(`https://run.googleapis.com/v2/projects/${project}/locations/us-central1/services/${name}`);
      if (service.reconciling || service.latestReadyRevision !== service.latestCreatedRevision ||
          !service.template.containers[0].image.endsWith(`@${image.imageDigest}`)) throw Error('Deploy both new handlers before activation');
    }
    const name = `projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`;
    const doc = await json(`https://firestore.googleapis.com/v1/${name}`);
    const ledger = JSON.parse(doc.fields.value.stringValue);
    if (ledger.id !== 'paid-202610' || ledger.stoppedAt !== undefined || Date.now() >= ledger.expiresAt || ledger.stopUsd !== 4.5 || ledger.limitUsd !== 5) throw Error('Pilot changed or stopped');
    if (ledger.billing) {
      for (const [key, value] of Object.entries(billing)) if (ledger.billing[key] !== value) throw Error('Billing configuration changed');
    } else {
      ledger.billing = billing;
      await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, 'POST', {
        writes: [{ update: { name, fields: { value: { stringValue: JSON.stringify(ledger) } } }, currentDocument: { updateTime: doc.updateTime } }],
      });
      receipt.changes.push('Armed automatic switch on first verified Google cost notification; counters and expiration retained');
    }
  }
  receipt.result = action === '--activate' ? 'awaiting-first-google-notification' : 'billing-feed-verified';
  writeFileSync('.local/actual-billing-config.json', JSON.stringify(billing, null, 2));
} catch (e) { receipt.error = e.message; throw e; }
finally { save(); console.log(JSON.stringify({ output, result: receipt.result, changes: receipt.changes, error: receipt.error, config: receipt.config }, null, 2)); }
