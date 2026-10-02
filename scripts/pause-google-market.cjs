// Reversible containment only. Does not delete resources/data or change billing.
// Default is read-only. The calling operator must authorize --apply.
const auth = require('firebase-tools/lib/auth');
const fs = require('node:fs');
const project = 'bazaarsignal-510305';
const root = `projects/${project}/locations/us-central1`;
(async () => {
  const account = auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account) throw new Error('Expected deployment account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  async function call(url, method='GET', body) {
    const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const d=await r.json(); if(!r.ok)throw new Error(`${r.status}: ${d.error?.message}`);return d;
  }
  const jobUrl=`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
  const iamUrl=`https://run.googleapis.com/v1/${root}/services/marketapi`;
  const policyUrl=`${iamUrl}:getIamPolicy?options.requestedPolicyVersion=3`;
  const job=await call(jobUrl), policy=await call(policyUrl);
  const before={at:new Date().toISOString(),project,job,policy};
  if(!process.argv.includes('--apply')) {console.log(JSON.stringify({at:new Date().toISOString(),project,jobState:job.state,publicInvoker:(policy.bindings??[]).some(b=>b.role==='roles/run.invoker'&&b.members.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')),apply:false}));return;}
  fs.mkdirSync('.local/zero-cost-backup',{recursive:true});
  const backup='.local/zero-cost-backup/containment-before.json';
  if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(before,null,2));
  if(job.state==='ENABLED')await call(`${jobUrl}:pause`,'POST',{});
  // Preserve every unrelated binding and the IAM etag precondition.
  policy.bindings=(policy.bindings??[]).map(b=>b.role==='roles/run.invoker'?{...b,members:b.members.filter(m=>m!=='allUsers'&&m!=='allAuthenticatedUsers')}:b).filter(b=>b.members.length);
  await call(`${iamUrl}:setIamPolicy`,'POST',{policy});
  const after={at:new Date().toISOString(),project,jobState:(await call(jobUrl)).state,policy:await call(policyUrl),billing:await call(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`)};
  fs.writeFileSync('.local/zero-cost-backup/containment-after.json',JSON.stringify(after,null,2));
  console.log(JSON.stringify(after,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
