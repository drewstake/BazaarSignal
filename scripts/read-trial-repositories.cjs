// Artifact Registry does not accept locations/- for repository listing. Discover
// its actual locations, then inspect all of them with bounded concurrency.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async () => {
  const project = 'bazaarsignal-510305';
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const out = { at: new Date().toISOString(), project, calls: 0, locations: [], repositories: [], errors: [] };
  async function get(url) {
    if (++out.calls > 100) throw new Error('Repository inventory call bound reached');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    if (!r.ok) throw new Error(`Repository inventory HTTP ${r.status}`);
    if (data.nextPageToken) throw new Error('Incomplete repository inventory pagination');
    return data;
  }
  const locations = await get(`https://artifactregistry.googleapis.com/v1/projects/${project}/locations?pageSize=100`);
  out.locations = (locations.locations ?? []).map(l => l.name);
  if (!out.locations.length || out.locations.length > 90 || out.locations.some(name => !name.startsWith(`projects/${project}/locations/`)))
    throw new Error('Unexpected repository location inventory');
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < out.locations.length) {
      const location = out.locations[next++];
      try { out.repositories.push(...((await get(`https://artifactregistry.googleapis.com/v1/${location}/repositories?pageSize=100`)).repositories ?? [])); }
      catch (error) { out.errors.push(`${location}: ${error.message}`); }
    }
  }));
  out.repositories.sort((a, b) => a.name.localeCompare(b.name));
  const target = `.local/trial-repositories-${out.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(target, JSON.stringify(out, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path: target, ...out, locations: out.locations.length }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
