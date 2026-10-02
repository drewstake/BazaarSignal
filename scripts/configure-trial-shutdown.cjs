// Minimal, expiring shutdown grants. Default is read-only. No invocation,
// deployment, billing changes, job activation, or application data access.
const fs = require('node:fs');
const auth = require('firebase-tools/lib/auth');
const project = 'bazaarsignal-510305';
const api = `https://run.googleapis.com/v1/projects/${project}/locations/us-central1/services/marketapi`;
const projectApi = `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
const members = ['market-reader', 'market-collector'].map(name => `serviceAccount:${name}@${project}.iam.gserviceaccount.com`);
const definitions = [
  { id: 'marketTrialSchedulerStop', title: 'Bounded market trial scheduler stop',
    permissions: ['cloudscheduler.jobs.get', 'cloudscheduler.jobs.pause'], scope: 'project' },
  { id: 'marketTrialApiStop', title: 'Bounded market trial API stop',
    permissions: ['run.services.getIamPolicy', 'run.services.setIamPolicy'], scope: 'marketapi' },
];
(async () => {
  const until = process.argv.find(arg => arg.startsWith('--until='))?.slice(8);
  const expiresAt = Date.parse(until ?? '');
  const startedAt = Date.now(), apply = process.argv.includes('--apply');
  const live = process.argv.includes('--free-tier-release');
  if (!Number.isFinite(expiresAt) || expiresAt <= startedAt || expiresAt > startedAt + (live ? 33 * 86400_000 : 60 * 60_000))
    throw new Error('Provide --until=<ISO time>, later than now and no more than 60 minutes away');
  const condition = { title: `market_trial_shutdown_${expiresAt}`,
    description: 'Temporary shutdown-only access for the bounded market trial',
    expression: `request.time < timestamp('${new Date(expiresAt).toISOString()}')` };
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const report = { at: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString(), apply,
    project, members, definitions, calls: 0, changes: [], rolesVerified: false, bindingsVerified: false };
  async function call(url, method = 'GET', body, allow404 = false) {
    if (++report.calls > 22) throw new Error('Shutdown grant call bound reached');
    const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.status === 404 && allow404) { await r.body?.cancel(); return null; }
    const data = await r.json();
    if (!r.ok) throw new Error(`Shutdown grant HTTP ${r.status}: ${data.error?.message ?? 'unknown'}`);
    return data;
  }
  const meta = await call(projectApi);
  if (meta.parent || meta.lifecycleState !== 'ACTIVE') throw new Error('Unexpected project inheritance or lifecycle');
  for (const def of definitions) {
    const roleUrl = `https://iam.googleapis.com/v1/projects/${project}/roles/${def.id}`;
    let role = await call(roleUrl, 'GET', undefined, true);
    if (role && (role.deleted || role.stage === 'DISABLED' || JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify([...def.permissions].sort())))
      throw new Error(`Existing ${def.id} differs; refusing to change an existing role`);
    if (!role && apply) {
      role = await call(`https://iam.googleapis.com/v1/projects/${project}/roles`, 'POST', {
        roleId: def.id, role: { title: def.title, description: 'Shutdown-only market trial permissions; no start, update, delete or billing access',
          includedPermissions: def.permissions, stage: 'GA' } });
      report.changes.push(`Created ${def.id}`);
    }
    def.exists = !!role;
  }
  for (const def of definitions) {
    const resource = def.scope === 'project' ? projectApi : api;
    const policy = def.scope === 'project'
      ? await call(`${resource}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } })
      : await call(`${resource}:getIamPolicy?options.requestedPolicyVersion=3`);
    if (!policy.etag) throw new Error('IAM etag unavailable');
    const role = `projects/${project}/roles/${def.id}`;
    const expired = (policy.bindings ?? []).filter(binding => binding.role === role && live &&
      binding.members.every(member => members.includes(member)) &&
      /^request.time < timestamp\('[^']+'\)$/.test(binding.condition?.expression ?? '') &&
      Date.parse(binding.condition.expression.match(/timestamp\('([^']+)'\)/)[1]) < startedAt);
    if (expired.length) policy.bindings = policy.bindings.filter(binding => !expired.includes(binding));
    const existing = (policy.bindings ?? []).filter(binding => binding.role === role);
    // Never silently renew an existing trial's authority or remove another grant.
    if (existing.some(binding => binding.condition?.expression !== condition.expression || binding.condition?.title !== condition.title ||
      binding.members.some(member => !members.includes(member))))
      throw new Error(`Existing grant for ${def.id} requires explicit inspection; no extension applied`);
    const next = structuredClone(policy); next.version = 3; next.bindings ??= [];
    if (!existing.length) next.bindings.push({ role, members, condition });
    else if (!members.every(member => existing[0].members.includes(member)))
      throw new Error('Existing grant is incomplete; refusing to expand it silently');
    if (apply && !existing.length) {
      await call(`${resource}:setIamPolicy`, 'POST', { policy: next });
      report.changes.push(`Granted ${def.id} until ${report.expiresAt}`);
    }
    def.proposedBinding = { role, members, condition };
    def.effectiveScope = def.scope === 'project'
      ? 'Scheduler get/pause within the collector project; job-name conditions are not claimed'
      : 'IAM get/set on marketapi only; no other service or project IAM authority';
  }
  if (apply) {
    for (const def of definitions) {
      const role = await call(`https://iam.googleapis.com/v1/projects/${project}/roles/${def.id}`);
      if (role.deleted || role.stage === 'DISABLED' || JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify([...def.permissions].sort()))
        throw new Error('Role readback mismatch');
      const policy = def.scope === 'project'
        ? await call(`${projectApi}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } })
        : await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
      if (!(policy.bindings ?? []).some(binding => binding.role === def.proposedBinding.role &&
        binding.condition?.expression === condition.expression && members.every(member => binding.members.includes(member))))
        throw new Error('Conditional grant readback mismatch');
    }
    report.rolesVerified = true; report.bindingsVerified = true;
  }
  const target = `.local/trial-shutdown-grants-${report.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path: target, ...report }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
