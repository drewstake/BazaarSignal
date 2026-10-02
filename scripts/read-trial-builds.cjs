// Exhaustive named regions from https://docs.cloud.google.com/build/docs/locations
// (checked 2026-10-01), plus the legacy global pool. No builds are started.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
const regions = ('global africa-south1 asia-east1 asia-east2 asia-northeast1 asia-northeast2 asia-northeast3 asia-south1 asia-south2 asia-southeast1 asia-southeast2 asia-southeast3 australia-southeast1 australia-southeast2 europe-central2 europe-north1 europe-north2 europe-southwest1 europe-west1 europe-west2 europe-west3 europe-west4 europe-west6 europe-west8 europe-west9 europe-west10 europe-west12 me-central1 me-central2 me-west1 northamerica-northeast1 northamerica-northeast2 northamerica-south1 southamerica-east1 southamerica-west1 us-central1 us-east1 us-east4 us-east5 us-south1 us-west1 us-west2 us-west3 us-west4').split(' ');
(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const report = { at: new Date().toISOString(), regions, calls: 0, builds: [], errors: [] };
  const queue = [...regions];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const region = queue.shift();
      try {
        report.calls++;
        const r = await fetch(`https://cloudbuild.googleapis.com/v1/projects/bazaarsignal-510305/locations/${region}/builds?pageSize=100`, {
          redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.access_token}` } });
        const d = await r.json();
        if (!r.ok || d.nextPageToken) throw new Error(`${r.status}: ${d.error?.message ?? 'Incomplete pagination'}`);
        report.builds.push(...(d.builds ?? []).map(b => ({ id: b.id, region, status: b.status,
          createTime: b.createTime, startTime: b.startTime, finishTime: b.finishTime, machineType: b.options?.machineType })));
      } catch (e) { report.errors.push({ region, error: e.message }); }
    }
  }));
  const path = `.local/trial-all-builds-${report.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path, ...report }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
