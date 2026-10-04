// Read-only, bounded evidence for a code rollout. Missing APIs/series are unknown.
// Never enables an API, retries a failed request, or reads credential contents out.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
const path = process.argv[2];
const repositoriesOnly = process.argv[3] === '--repositories-only';
if (process.argv.length > 4 || (process.argv[3] && !repositoriesOnly)) throw new Error('Unknown inspection option');
if (!/^\.local\/[a-z0-9-]+\.json$/.test(path ?? '') || fs.existsSync(path))
  throw new Error('Supply a new .local/<receipt>.json path');
(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Existing deployment login unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  const report = { at: new Date().toISOString(), attempts: 0, limit: 24, results: {}, errors: [] };
  const save = () => fs.writeFileSync(path, JSON.stringify(report, null, 2));
  fs.writeFileSync(path, JSON.stringify(report), { flag: 'wx' });
  const read = async (name, url) => {
    if (++report.attempts > report.limit) throw new Error('Inspection request limit reached');
    save();
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      const bytes = await response.text();
      if (bytes.length > 2 * 1024 ** 2) throw new Error('Response exceeds bound');
      const value = JSON.parse(bytes);
      if (!response.ok) { report.errors.push({ name, status: response.status, reason: value.error?.status }); return; }
      report.results[name] = value;
      if (value.nextPageToken) report.errors.push({ name, reason: 'Incomplete bounded page' });
    } catch { report.errors.push({ name, reason: 'Unavailable; no retry' }); }
    finally { save(); }
  };
  const end = new Date().toISOString(), start = '2026-10-01T07:00:00Z';
  for (const project of ['bazaarsignal-510305', 'hip-fusion-451104-t5', 'nail-salon-app-457601']) {
    if (!repositoriesOnly) await read(`${project}/billing`, `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
    // Asset search covers locations, unlike a single-region registry listing.
    const query = new URLSearchParams({ assetTypes: 'artifactregistry.googleapis.com/Repository', pageSize: '100' });
    await read(`${project}/repositories`, `https://cloudasset.googleapis.com/v1/projects/${project}:searchAllResources?${query}`);
    if (repositoriesOnly) continue;
    for (const metric of ['run.googleapis.com/container/billable_instance_time', 'run.googleapis.com/request_count']) {
      const query = new URLSearchParams({ filter: `metric.type="${metric}"`,
        'interval.startTime': start, 'interval.endTime': end, view: 'FULL', pageSize: '1000',
        'aggregation.alignmentPeriod': '86400s', 'aggregation.perSeriesAligner': 'ALIGN_SUM',
        'aggregation.crossSeriesReducer': 'REDUCE_SUM' });
      await read(`${project}/${metric}`, `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${query}`);
    }
  }
  save();
  console.log(JSON.stringify({ receipt: path, at: report.at, attempts: report.attempts, errors: report.errors,
    sources: Object.entries(report.results).map(([name, data]) => ({ name,
      billingEnabled: data.billingEnabled, resources: data.results?.map(r => r.name),
      timeSeries: data.timeSeries?.length ?? null })) }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
