// Post-deploy read-only verification. No collection requests or user writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const label=process.argv[2]??'usage';if(!/^usage(?:-[a-z-]+)?$/.test(label))throw new Error('Invalid verification label');
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
 const get=async(url)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw new Error(`${r.status}: ${d.error?.message}`);return d;};
 const region='projects/bazaarsignal-510305/locations/us-central1';
 const [api,collector,job,doc]=await Promise.all([
  get(`https://run.googleapis.com/v2/${region}/services/marketapi`),get(`https://run.googleapis.com/v2/${region}/services/refreshmarket`),
  get(`https://cloudscheduler.googleapis.com/v1/${region}/jobs/firebase-schedule-refreshMarket-us-central1`),
  get('https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/live-allowance')]);
 const ledger=JSON.parse(doc.fields.value.stringValue),before=JSON.parse(fs.readFileSync(`.local/${label}-predeploy-ledger.json`,'utf8')).ledger;
 assert.equal(ledger.id,before.id);assert.equal(ledger.startsAt,before.startsAt);assert.equal(ledger.expiresAt,before.expiresAt);
 assert.deepEqual(ledger.monthlyLimits,before.monthlyLimits);assert.deepEqual(ledger.dailyLimits,before.dailyLimits);
 for(const [key,value] of Object.entries(before.monthlyReserved))assert(ledger.monthlyReserved[key]>=value,`Reservation reset: ${key}`);
 assert.equal(job.schedule,'0 * * * *');assert.equal(job.state,'ENABLED');
 assert(collector.latestReadyRevision.endsWith('/refreshmarket-00009-4bz'),'Collector revision changed');
 const results=[];
 for(const headers of [{},{Authorization:'Bearer forged.invalid.signature000000'}]){
  const r=await fetch(api.uri+'/api/owner/usage?email=drewstake3@gmail.com&uid=owner',{headers,signal:AbortSignal.timeout(15000)});
  const body=await r.json();assert.equal(r.status,401);assert.deepEqual(Object.keys(body),['error']);assert.match(r.headers.get('cache-control'),/no-store/);results.push({status:r.status,body});
 }
 const firestore=await fetch('https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/usage-dashboard');
 assert([401,403].includes(firestore.status));
 const report={at:new Date().toISOString(),api:api.uri,apiRevision:api.latestReadyRevision,collectorRevision:collector.latestReadyRevision,scheduler:job.state,schedule:job.schedule,ledgerIdentity:ledger.id,deadline:ledger.expiresAt,countersPreserved:true,directUnauthorized:results,privateCacheStatus:firestore.status};
 fs.writeFileSync(`.local/${label}-live-verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
