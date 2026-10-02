// Fresh, bounded control-plane inventory without Monitoring time-series calls.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async () => {
  const project = 'bazaarsignal-510305', region = `projects/${project}/locations/us-central1`;
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const result = { at: new Date().toISOString(), project, calls: 0, resources: {}, errors: [] };
  async function call(url, body) {
    if (++result.calls > 24) throw new Error('Control-plane inventory budget reached');
    const r = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok) throw new Error(`Inventory HTTP ${r.status}: ${data.error?.message ?? 'unknown'}`);
    if (data.nextPageToken) throw new Error('Incomplete inventory pagination');
    return data;
  }
  const plans = {
    billing: `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,
    mainBilling: 'https://cloudbilling.googleapis.com/v1/projects/bazaarsignal/billingInfo',
    sharedProjects: 'https://cloudbilling.googleapis.com/v1/billingAccounts/012803-EA91BE-8DCD32/projects',
    jobs: `https://cloudscheduler.googleapis.com/v1/${region}/jobs`,
    services: `https://run.googleapis.com/v2/${region}/services`,
    apiIam: `https://run.googleapis.com/v1/${region}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`,
    collectorIam: `https://run.googleapis.com/v1/${region}/services/refreshmarket:getIamPolicy?options.requestedPolicyVersion=3`,
    databases: `https://firestore.googleapis.com/v1/projects/${project}/databases`,
    repositories: `https://artifactregistry.googleapis.com/v1/${region}/repositories`,
    builds: `https://cloudbuild.googleapis.com/v1/${region}/builds?pageSize=100`,
    logBuckets: `https://logging.googleapis.com/v2/projects/${project}/locations/global/buckets`,
    buckets: `https://storage.googleapis.com/storage/v1/b?project=${project}`,
  };
  for (const [name, url] of Object.entries(plans)) {
    try {
      const data = await call(url);
      if (name === 'services') {
        for (const s of data.services ?? []) {
          // Keep configuration needed by the cost/region check, not arbitrary env.
          for (const c of s.template?.containers ?? []) c.env = (c.env ?? []).filter(e =>
            ['GCLOUD_PROJECT','FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE','MARKET_TRIAL_ID','MARKET_TRIAL_START','MARKET_TRIAL_END'].includes(e.name));
        }
      }
      if (name === 'builds') data.builds = (data.builds ?? []).map(b => ({ id: b.id, status: b.status,
        createTime: b.createTime, startTime: b.startTime, finishTime: b.finishTime, options: b.options }));
      result.resources[name] = data;
    } catch (error) { result.errors.push(`${name}: ${error.message}`); }
  }
  result.billingHistory = await call('https://logging.googleapis.com/v2/entries:list', {
    resourceNames: ['billingAccounts/012803-EA91BE-8DCD32', 'projects/bazaarsignal-510305', 'projects/hip-fusion-451104-t5', 'projects/nail-salon-app-457601'],
    filter: 'timestamp >= "2026-10-01T07:00:00Z" AND protoPayload.serviceName="cloudbilling.googleapis.com"',
    pageSize: 100, orderBy: 'timestamp asc',
  });
  result.billingHistory.entries = (result.billingHistory.entries ?? []).map(e => ({ timestamp: e.timestamp,
    method: e.protoPayload?.methodName, resourceName: e.protoPayload?.resourceName, status: e.protoPayload?.status }));
  const target = `.local/trial-resources-${result.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path: target, at: result.at, calls: result.calls, errors: result.errors,
    sharedProjects: result.resources.sharedProjects, repositories: result.resources.repositories,
    jobStates: result.resources.jobs?.jobs?.map(job => ({ name: job.name, state: job.state, lastAttemptTime: job.lastAttemptTime })),
    billingChanges: result.billingHistory.entries }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
