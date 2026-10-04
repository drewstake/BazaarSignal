// Configure the existing job and provider policy without activating collection.
// Preserve every ledger field, job deadline, cooldown, lease and saved snapshot.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const auth = require('firebase-tools/lib/auth');
(async () => {
  const apply = process.argv[2] === '--apply';
  if (process.argv.length > 3 || (process.argv[2] && !apply)) throw Error('Use [--apply]');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw Error('Deployment account unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  let calls = 0;
  async function call(url, method = 'GET', body) {
    if (++calls > 10) throw Error('Control-plane call bound reached');
    const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await r.json();
    if (!r.ok) throw Error(`Configuration HTTP ${r.status}: ${data.error?.message}`);
    return data;
  }
  const root = 'https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents';
  const jobUrl = 'https://cloudscheduler.googleapis.com/v1/projects/bazaarsignal-510305/locations/us-central1/jobs/firebase-schedule-refreshMarket-us-central1';
  const job = await call(jobUrl);
  assert.equal(job.state, 'PAUSED');
  assert.ok(['0 * * * *', '*/5 * * * *'].includes(job.schedule));
  const ledger = await call(`${root}/marketCache/live-allowance`);
  const doc = await call(`${root}/marketCache/control`);
  const control = JSON.parse(doc.fields.value.stringValue);
  assert.ok(!control.lease || control.lease.until <= Date.now());
  const next = structuredClone(control);
  next.policy.bazaarMs = 300000;
  const report = { at: new Date().toISOString(), apply, job, ledger, control };
  const receipt = `.local/paused-cadence-${apply ? 'apply' : 'inspect'}.json`;
  fs.writeFileSync(receipt, JSON.stringify(report, null, 2), { flag: 'wx' });
  if (apply) {
    // Compare-and-swap only the serialized control value; never replace accounting.
    await call(`${root}:commit`, 'POST', { writes: [{
      update: { name: doc.name, fields: { value: { stringValue: JSON.stringify(next) } } },
      updateMask: { fieldPaths: ['value'] }, currentDocument: { updateTime: doc.updateTime },
    }] });
    await call(`${jobUrl}?updateMask=schedule`, 'PATCH', { name: job.name, schedule: '*/5 * * * *' });
    const afterJob = await call(jobUrl);
    assert.equal(afterJob.state, 'PAUSED');
    assert.equal(afterJob.schedule, '*/5 * * * *');
    assert.deepEqual(await call(`${root}/marketCache/live-allowance`), ledger);
    const afterControl = await call(`${root}/marketCache/control`);
    assert.deepEqual(JSON.parse(afterControl.fields.value.stringValue), next);
    report.verified = true;
    fs.writeFileSync(receipt, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ apply, calls, verified: report.verified, schedule: '*/5 * * * *', state: 'PAUSED' }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
