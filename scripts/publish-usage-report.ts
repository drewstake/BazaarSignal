// Explicit owner-report publication only. No background task or activation.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createLocalUsageReport } from '../server/local-usage';
import { publishOwnerUsage } from '../server/publish-usage';
import { OWNER_EMAIL } from '../collector/usage-dashboard';

if(process.argv.length!==3 || process.argv[2]!=='--publish')throw new Error('Pass --publish to publish the owner report.');
const require=createRequire(resolve('package.json')),auth=require('firebase-tools/lib/auth');
const account=auth.getAllAccounts().find((a:any)=>a.user.email===OWNER_EMAIL);
if(!account)throw new Error('Existing owner login unavailable.');
const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
const at=new Date().toISOString(), file=`.local/usage-publication-${at.replace(/[:.]/g,'-')}.json`;
const receipt:any={at,reservedRequests:5,attempts:0,requests:[],measurementAdmission:'Existing durable 30-minute local report cache; failures retain their slot.'};
writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
const save=()=>writeFileSync(file,JSON.stringify(receipt,null,2));
const request=async(url:string,init:RequestInit={})=>{
  const parsed=new URL(url), method=init.method??'GET';
  if(!['firestore.googleapis.com','cloudscheduler.googleapis.com'].includes(parsed.hostname) ||
    !['GET','PATCH'].includes(method) || ++receipt.attempts>receipt.reservedRequests)throw new Error('Publication request bound exceeded.');
  // Failed/uncertain writes retain their attempt. No retry or counter refund.
  receipt.requests.push({method,path:parsed.pathname});save();
  return fetch(url,{...init,headers:{...init.headers,Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
};
try {
  const scheduler=await request('https://cloudscheduler.googleapis.com/v1/projects/bazaarsignal-510305/locations/us-central1/jobs/firebase-schedule-refreshMarket-us-central1');
  if(!scheduler.ok||(await scheduler.json()).state!=='PAUSED')throw new Error('Expected collection to remain paused.');
  const snapshot=await createLocalUsageReport()();
  writeFileSync('.local/usage-dashboard-measured.json',JSON.stringify(snapshot,null,2));
  receipt.result=await publishOwnerUsage(snapshot,request);
  receipt.stale=!!snapshot.stale || Date.now()>=snapshot.nextMeasurementAt;
} catch(error) {receipt.error=error instanceof Error?error.message:'Publication unavailable';throw error;}
finally {save();console.log(JSON.stringify({receipt:file,result:receipt.result,stale:receipt.stale,error:receipt.error},null,2));}
