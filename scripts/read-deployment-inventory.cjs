// Bounded read-only fallback when Cloud Asset inventory is unavailable.
// Lists every supported Artifact Registry location, and uses the global Run
// inventory. Pagination, unreachable regions and disabled APIs remain explicit.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async () => {
  const file = process.argv[2];
  if (!/^\.local\/[a-z0-9-]+\.json$/.test(file ?? '') || fs.existsSync(file))
    throw new Error('Supply a new .local/<receipt>.json');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Existing owner login unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  const project = 'bazaarsignal-510305';
  const out = { at: new Date().toISOString(), calls: 0, limit: 90, resources: {}, errors: [] };
  fs.writeFileSync(file, JSON.stringify(out), { flag: 'wx' });
  const save = () => fs.writeFileSync(file, JSON.stringify(out, null, 2));
  async function read(name, url, body) {
    if (++out.calls > out.limit) throw new Error('Inventory request bound exhausted');
    save();
    try {
      const r = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      const chunks = []; let length = 0;
      for await (const b of r.body) {
        length += b.length; if (length > 4 * 1024 ** 2) throw new Error('Response bound exceeded');
        chunks.push(b);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${data.error?.status}; ${(data.error?.details ?? []).map(d => d.reason).filter(Boolean).join(',')}`);
      // Inventory needs configuration, never secret environment values.
      function redact(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'env') delete value[key]; else redact(child);
        }
      }
      redact(data);
      out.resources[name] = data;
      if (data.nextPageToken || data.metadata?.continue || data.unreachable?.length)
        out.errors.push({ name, reason: 'Incomplete page or unreachable region' });
      return data;
    } catch (e) { out.errors.push({ name, reason: e.message }); }
    finally { save(); }
  }
  const locations = await read('artifactLocations', `https://artifactregistry.googleapis.com/v1/projects/${project}/locations?pageSize=100`);
  if (locations && !locations.nextPageToken && locations.locations?.length <= 65) {
    for (let i = 0; i < locations.locations.length; i += 5) {
      await Promise.all(locations.locations.slice(i, i + 5).map(l => {
        if (!/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+$/.test(l.name) || !l.name.startsWith(`projects/${project}/`))
          throw new Error('Unexpected location identity');
        return read(`repositories/${l.locationId}`, `https://artifactregistry.googleapis.com/v1/${l.name}/repositories?pageSize=1000`);
      }));
    }
  } else out.errors.push({ name: 'artifactLocations', reason: 'Location scope not complete within bound' });
  await read('runServicesGlobal', `https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${project}/services?limit=1000`);
  await read('runJobsGlobal', `https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${project}/jobs?limit=1000`);
  await read('projectIam', `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
  for (const role of ['marketTrialSchedulerStop', 'marketTrialApiStop'])
    await read(role, `https://iam.googleapis.com/v1/projects/${project}/roles/${role}`);
  for (const old of ['hip-fusion-451104-t5', 'nail-salon-app-457601'])
    await read(`${old}/artifactLocations`, `https://artifactregistry.googleapis.com/v1/projects/${old}/locations?pageSize=100`);
  out.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ file, at: out.at, calls: out.calls, errors: out.errors,
    locations: locations?.locations?.length,
    repositories: Object.entries(out.resources).filter(([k]) => k.startsWith('repositories/')).flatMap(([, d]) => d.repositories ?? []),
    services: out.resources.runServicesGlobal?.items?.map(s => s.metadata?.name),
    jobs: out.resources.runJobsGlobal?.items?.map(s => s.metadata?.name) }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
