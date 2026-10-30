// Compact read-only pilot verification. No invocation, retry or budget mutation.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth'),crypto=require('node:crypto');
(async()=>{
  const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');if(!a)throw Error('Owner login missing');
  const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
  const root='projects/bazaarsignal-510305/locations/us-central1',db='projects/bazaarsignal-510305/databases/(default)/documents/marketCache';
  const result={at:new Date().toISOString()};
  for(const [key,url] of Object.entries({paid:`https://firestore.googleapis.com/v1/${db}/paid-budget-october`,legacy:`https://firestore.googleapis.com/v1/${db}/live-allowance`,control:`https://firestore.googleapis.com/v1/${db}/control`,scheduler:`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`})){
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error(`Verification ${key} HTTP ${r.status}`);
    const text=await r.text();if(text.length>1024**2)throw Error('Verification response exceeded bound');
    const data=JSON.parse(text);result[key]=data.fields?JSON.parse(data.fields.value.stringValue):data;
  }
  result.legacyUnchanged=crypto.createHash('sha256').update(JSON.stringify(result.legacy)).digest('hex')===result.paid.legacyLedgerSha256;
  const file=`.local/paid-observation-${Date.now()}.json`;fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({file,at:result.at,legacyUnchanged:result.legacyUnchanged,scheduler:{state:result.scheduler.state,schedule:result.scheduler.schedule,lastAttemptTime:result.scheduler.lastAttemptTime,status:result.scheduler.status},budget:{version:result.paid.version,admissionCount:result.paid.admissionCount??Object.keys(result.paid.admissions).length,reservedUsd:result.paid.reservedUsd,stopUsd:result.paid.stopUsd,stoppedAt:result.paid.stoppedAt,reason:result.paid.reason,admissions:result.paid.admissions,observed:result.paid.observed},bazaar:result.control.jobs.bazaar},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
