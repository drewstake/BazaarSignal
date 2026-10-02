// Read-only, explicitly bounded comparison against the console charge period.
// This does NOT assume every product's free allowance uses this reset boundary.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async () => {
  const start = process.argv[2];
  if (!start || !Number.isFinite(Date.parse(start))) throw new Error('Supply an explicit ISO period start');
  const end = new Date().toISOString();
  if (Date.parse(start) >= Date.parse(end)) throw new Error('Period has not started');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected deployment account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const out = { at: end, start, project: 'bazaarsignal-510305', purpose: 'Reconcile operational counters with the console charge period, not certify all allowance resets', apiCalls: 0, metrics: {}, errors: [] };
  for (const type of [
    'run.googleapis.com/request_count', 'run.googleapis.com/container/cpu/allocation_time',
    'run.googleapis.com/container/memory/allocation_time', 'run.googleapis.com/container/network/sent_bytes_count',
    'firestore.googleapis.com/document/read_ops_count', 'firestore.googleapis.com/document/write_ops_count',
    'storage.googleapis.com/api/request_count', 'storage.googleapis.com/network/sent_bytes_count',
  ]) {
    try {
      const q = new URLSearchParams({ filter: `metric.type="${type}"`, 'interval.startTime': start, 'interval.endTime': end, pageSize: '1000' });
      out.apiCalls++;
      const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${out.project}/timeSeries?${q}`, {
        headers: { Authorization: `Bearer ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`${r.status}: ${data.error?.message}`);
      out.metrics[type] = data;
      if (data.nextPageToken) out.errors.push(`${type}: bounded read incomplete; do not use as a complete baseline`);
    } catch (e) { out.errors.push(`${type}: ${e.message}`); }
  }
  const summary = Object.fromEntries(Object.entries(out.metrics).map(([type, data]) => {
    const rows = data.timeSeries?.flatMap(s => s.points.map(p => ({ labels: s.metric.labels ?? {}, ...p }))) ?? [];
    const count = p => Number(p.value.int64Value ?? p.value.doubleValue);
    const labels = p => JSON.stringify(Object.fromEntries(Object.entries(p.labels).sort(([a], [b]) => a.localeCompare(b))));
    return [type, { series: data.timeSeries?.length ?? 0, points: rows.length,
      sum: rows.length ? rows.reduce((n,p) => n + count(p), 0) : null,
      boundaryOverlaps: rows.filter(p => Date.parse(p.interval.startTime) < Date.parse(start)).length,
      byLabel: Object.fromEntries([...new Set(rows.map(labels))].map(label => [label, rows.filter(p => labels(p) === label).reduce((n,p) => n + count(p), 0)])),
    }];
  }));
  out.summary = summary;
  const path = `.local/trial-period-${end.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path, at: end, start, apiCalls: out.apiCalls, summary, errors: out.errors }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
