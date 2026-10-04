// Bounded read-only release evidence and rollback copy. No collection, deployment,
// billing, IAM, user-data mutation, or credential output.
const fs = require('node:fs'), crypto = require('node:crypto');
const auth = require('firebase-tools/lib/auth');
(async () => {
  const label = process.argv[2];
  if (!['before', 'after'].includes(label)) throw Error('Use before or after');
  const directory = `.local/portfolio-release-${label}`;
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(`${directory}/receipt.json`)) throw Error('Receipt already exists; preserve it.');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw Error('Expected deployment account unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  let calls = 0;
  const call = async (url, body) => {
    if (++calls > 32) throw Error('Release inspection request bound reached');
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw Error(`Inspection HTTP ${response.status}: ${data.error?.message}`);
    if (data.nextPageToken) throw Error('Incomplete release inventory');
    return data;
  };
  const region = 'projects/bazaarsignal-510305/locations/us-central1';
  const receipt = { at: new Date().toISOString(), calls: 0, projects: {}, collections: {}, control: {} };
  for (const project of ['bazaarsignal', 'bazaarsignal-510305']) {
    const identity = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
    const billing = await call(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
    receipt.projects[project] = { projectId: identity.projectId, number: identity.projectNumber, lifecycle: identity.lifecycleState, billingEnabled: billing.billingEnabled };
  }
  for (const [name, url] of Object.entries({
    jobs: `https://cloudscheduler.googleapis.com/v1/${region}/jobs`,
    services: `https://run.googleapis.com/v2/${region}/services`,
    apiIam: `https://run.googleapis.com/v1/${region}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`,
    collectorIam: `https://run.googleapis.com/v1/${region}/services/refreshmarket:getIamPolicy?options.requestedPolicyVersion=3`,
    ledger: 'https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/live-allowance',
    usage: 'https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/usage-dashboard',
  })) {
    const data = await call(url);fs.writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2), { flag: 'wx' });
    receipt.control[name] = { sha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') };
    if (name === 'jobs') receipt.control[name].states = data.jobs?.map(job => ({ name: job.name, state: job.state, schedule: job.schedule }));
    if (name === 'ledger') { const value = JSON.parse(data.fields.value.stringValue);receipt.control[name].hypixelRequests=value.observed.hypixelRequests;receipt.control[name].stoppedAt=value.stoppedAt; }
    if (name === 'services') receipt.control[name].revisions=data.services?.map(service=>({name:service.name,revision:service.latestReadyRevision}));
  }
  // Original Positions and delivery ledgers are the only old data the new code
  // can migrate. Save originals and the new private collections before release.
  for (const id of ['positions','positionMigrations','portfolios','holdings','portfolioNotifications','portfolioPreferences','backendUsers','backend','alertLinks']) {
    const rows = await call('https://firestore.googleapis.com/v1/projects/bazaarsignal/databases/(default)/documents:runQuery', {
      structuredQuery: { from: [{ collectionId: id, allDescendants: true }], limit: 1001 },
    });
    const documents=rows.filter(row=>row.document).map(row=>row.document);
    if(documents.length>1000)throw Error(`Backup bound reached for ${id}; no partial backup may authorize release`);
    fs.writeFileSync(`${directory}/${id}.json`,JSON.stringify(documents,null,2),{flag:'wx'});
    receipt.collections[id]={count:documents.length,sha256:crypto.createHash('sha256').update(JSON.stringify(documents)).digest('hex')};
  }
  receipt.calls=calls;fs.writeFileSync(`${directory}/receipt.json`,JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify(receipt,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
