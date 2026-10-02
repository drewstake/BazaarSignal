// Read-only reconciliation of current links and historical billing scope.
// The two historical IDs below were observed in this account's Billing Reports
// project filter. No project payloads, credentials or private application data.
const fs = require('node:fs');
const auth = require('firebase-tools/lib/auth');
(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected deployment account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const at = new Date();
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
  const billingAccount = 'billingAccounts/012803-EA91BE-8DCD32';
  const report = { at: at.toISOString(), start, apiCalls: 0, billingAccount,
    // This is an earlier UI observation, NEVER re-timestamped as a fresh bill.
    consoleEvidence: { observedAt: '2026-10-01T08:30:00Z', reportedCost: '$0.00', period: 'October 1, 2026', rows: 'No results to display',
      projectFilter: ['hip-fusion-451104-t5', 'nail-salon-app-457601'],
      interpretation: 'The console has no usage rows; it cannot certify remaining allowance.' },
    projects: {}, logs: {}, errors: [], historicalScopeVerified: false };
  async function call(url, body) {
    report.apiCalls++;
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${data.error?.message}`);
    return data;
  }
  for (const id of ['bazaarsignal', 'bazaarsignal-510305', ...report.consoleEvidence.projectFilter]) {
    try {
      const billing = await call(`https://cloudbilling.googleapis.com/v1/projects/${id}/billingInfo`);
      const meta = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${id}`);
      report.projects[id] = { billing, lifecycleState: meta.lifecycleState, createTime: meta.createTime };
    } catch (e) { report.errors.push(`${id}: ${e.message}`); }
  }
  for (const scope of [billingAccount, 'projects/bazaarsignal', 'projects/bazaarsignal-510305',
    ...report.consoleEvidence.projectFilter.map(id => `projects/${id}`)]) {
    try {
      const entries = []; let pageToken;
      do {
        const data = await call('https://logging.googleapis.com/v2/entries:list', {
          resourceNames: [scope], filter: `timestamp >= "${start}" AND protoPayload.serviceName="cloudbilling.googleapis.com"`,
          pageSize: 100, orderBy: 'timestamp asc', ...(pageToken ? { pageToken } : {}),
        });
        for (const entry of data.entries ?? []) {
          const p = entry.protoPayload ?? {};
          entries.push({ timestamp: entry.timestamp, method: p.methodName, resourceName: p.resourceName,
            status: p.status, request: p.request, response: p.response });
        }
        pageToken = data.nextPageToken;
        if (entries.length > 1000) throw new Error('Billing history exceeds bounded inspection; scope remains unverified');
      } while (pageToken);
      report.logs[scope] = entries;
    } catch (e) { report.errors.push(`${scope}: ${e.message}`); }
  }
  report.historyCompleteForInspectedScopes = report.errors.length === 0;
  report.remainingVerification = 'Successful log reads alone do not reconcile consumption by formerly linked projects or establish that every historical account member was inspected.';
  fs.writeFileSync('.local/trial-billing-scope.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ at: report.at, apiCalls: report.apiCalls, projects: report.projects,
    logSummaries: Object.fromEntries(Object.entries(report.logs).map(([key,entries]) => [key, entries.map(e => ({timestamp:e.timestamp,method:e.method,resourceName:e.resourceName}))])),
    errors: report.errors }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
