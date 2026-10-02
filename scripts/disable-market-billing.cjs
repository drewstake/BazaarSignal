// Run ONLY after the human approves the documented effects. Default is read-only.
// Never deletes a project or user records; never enables billing.
const auth=require('firebase-tools/lib/auth'),fs=require('node:fs');
const {isDeepStrictEqual}=require('node:util');
const {verifyMarketBackup}=require('./verify-market-backup.cjs');
const project='bazaarsignal-510305',root=`projects/${project}/locations/us-central1`;
(async()=>{
 const apply=process.argv.includes('--apply'), offline=process.argv.includes('--verify-backup');
 let manifest,documents;
 const dir='.local/zero-cost-backup';
 if(apply||offline){
  manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`,'utf8'));
  documents=JSON.parse(fs.readFileSync(`${dir}/marketCache.json`,'utf8'));
  const verified=verifyMarketBackup({manifest,documents,containment:JSON.parse(fs.readFileSync(`${dir}/containment-after.json`,'utf8')),readFile:file=>fs.readFileSync(`${dir}/${file}`)});
  if(offline){console.log(JSON.stringify({offline:true,...verified},null,2));return;}
 }
 if(apply&&!process.argv.includes(`--approved-project=${project}`))throw new Error('Explicit approval for this project is required. Read docs/ZERO-COST-AUDIT.md.');
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 if(!account)throw new Error('Expected deployment account unavailable');
 const token=await auth.getAccessToken(account.tokens.refresh_token,[]);
 async function call(url,method='GET',body){const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(`${r.status}: ${d.error?.message}`);return d;}
 const url=`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`;
 const billing=await call(url);
 if(!apply){console.log(JSON.stringify({project,billing,apply:false,impact:'Stops paid collector services; bucket access may be lost and some Cloud resources can be removed by Google. Main website/auth/private records stay in the separate Spark project. Existing charges remain payable.'},null,2));return;}
 const job=await call(`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`);
 const iam=await call(`https://run.googleapis.com/v1/${root}/services/marketapi:getIamPolicy`);
 if(job.state!=='PAUSED'||iam.bindings?.some(b=>b.role==='roles/run.invoker'&&b.members.some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))throw new Error('Pause schedule and public invocation first');
 const db=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 const collections=await call(`${db}:listCollectionIds`,'POST',{pageSize:1000});
 if(collections.nextPageToken||collections.collectionIds?.length!==1||collections.collectionIds[0]!=='marketCache')throw new Error('Collector data layout changed; preserve all data before shutdown');
 const current=await call(`${db}/marketCache?pageSize=1000`);
 if(current.nextPageToken||current.documents?.length!==documents.documents.length||current.documents.some(doc=>{
  const saved=documents.documents.find(d=>d.name===doc.name);
  return !saved||saved.updateTime!==doc.updateTime||!isDeepStrictEqual(saved.fields,doc.fields);
 }))throw new Error('Collector changed after backup; refresh and verify backup first');
 const main=await call('https://cloudbilling.googleapis.com/v1/projects/bazaarsignal/billingInfo');
 if(main.billingEnabled!==false||main.billingAccountName)throw new Error('Main project billing changed; re-audit before continuing');
 if(billing.billingEnabled)await call(url,'PUT',{billingAccountName:''});
 const verified=await call(url);
 fs.writeFileSync(`${dir}/billing-disabled.json`,JSON.stringify({at:new Date().toISOString(),billing:verified,main},null,2));
 if(verified.billingEnabled||verified.billingAccountName)throw new Error('Billing shutdown unverified');
 console.log(JSON.stringify({at:new Date().toISOString(),billing:verified,main},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
