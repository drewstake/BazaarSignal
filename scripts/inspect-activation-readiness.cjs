// Bounded read-only activation evidence. No collection, deployment, IAM changes,
// billing changes, service activation, cleanup, or retries. Preserve the receipt.
const fs=require('node:fs'), auth=require('firebase-tools/lib/auth');
const receipt=process.argv[2];
if(!receipt || !/^\.local\/[a-z0-9-]+\.json$/.test(receipt))throw new Error('Supply a new .local/<receipt>.json path');
(async()=>{
  if(fs.existsSync(receipt)){console.log(JSON.stringify({saved:receipt,...JSON.parse(fs.readFileSync(receipt,'utf8')).summary},null,2));return;}
  const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw new Error('Existing owner login unavailable');
  const access=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  const p='bazaarsignal-510305',root=`projects/${p}/locations/us-central1`;
  const report={at:new Date().toISOString(),reservedRequests:24,attempts:0,resources:{},errors:[]};
  fs.writeFileSync(receipt,JSON.stringify(report,null,2),{flag:'wx'});
  const save=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2));
  async function get(name,url){
    if(++report.attempts>report.reservedRequests)throw new Error('Inspection reservation exhausted');save();
    try{
      const r=await fetch(url,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(10000)});
      const text=await r.text();if(text.length>4*1024**2)throw new Error('Bounded response exceeded');
      const data=JSON.parse(text);
      if(!r.ok){report.errors.push({name,status:r.status,reason:data.error?.status});return null;}
      // Redact before the first durable write, including partial/error receipts.
      for(const c of data?.template?.containers??[])c.env=(c.env??[]).filter(e=>['MARKET_LIVE_ID','MARKET_LIVE_END','MARKET_OPERATING_MODE','FUNCTION_TARGET'].includes(e.name));
      if(data.nextPageToken)report.errors.push({name,reason:'Incomplete bounded page'});
      report.resources[name]=data;return data;
    }catch{report.errors.push({name,reason:'Unavailable; no retry'});return null;}
    finally{save();}
  }
  await get('linkedProjects','https://cloudbilling.googleapis.com/v1/billingAccounts/012803-EA91BE-8DCD32/projects');
  for(const service of ['marketapi','refreshmarket']){
    await get(service,`https://run.googleapis.com/v2/${root}/services/${service}`);
    await get(`${service}Iam`,`https://run.googleapis.com/v1/${root}/services/${service}:getIamPolicy?options.requestedPolicyVersion=3`);
  }
  await get('scheduler',`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`);
  await get('ledger',`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/marketCache/live-allowance`);
  await get('database',`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)`);
  const buckets=await get('buckets',`https://storage.googleapis.com/storage/v1/b?project=${p}`);
  if((buckets?.items?.length??0)>3)report.errors.push({name:'buckets',reason:'More buckets than reviewed bound'});
  for(const bucket of (buckets?.items??[]).slice(0,3)){
    await get(`${bucket.name}-versions`,`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket.name)}/o?versions=true&maxResults=1000`);
    if(Number(bucket.softDeletePolicy?.retentionDurationSeconds??0)>0)
      await get(`${bucket.name}-soft-deleted`,`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket.name)}/o?softDeleted=true&maxResults=1000`);
  }
  // Artifact Registry does not accept a wildcard location for this endpoint.
  // This bounded check covers the known region only, never the whole account.
  await get('repositories',`https://artifactregistry.googleapis.com/v1/${root}/repositories?pageSize=1000`);
  const raw=report.resources.ledger?.fields?.value?.stringValue,ledger=raw?JSON.parse(raw):null;
  report.summary={at:report.at,attempts:report.attempts,errors:report.errors,
    scheduler:report.resources.scheduler?.state,
    apiPublic:(report.resources.marketapiIam?.bindings??[]).some(b=>b.role==='roles/run.invoker'&&b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m))),
    ledger:ledger?{id:ledger.id,expiresAt:ledger.expiresAt,stoppedAt:ledger.stoppedAt,reason:ledger.reason,hasCapacity:!!ledger.capacity,monthlyReserved:ledger.monthlyReserved,dailyReserved:ledger.dailyReserved}:null,
    buckets:Object.entries(report.resources).filter(([k])=>k.endsWith('-versions')||k.endsWith('-soft-deleted')).map(([name,d])=>({name,objects:(d.items??[]).length,bytes:(d.items??[]).reduce((n,o)=>n+Number(o.size),0),complete:!d.nextPageToken})),
    repositoryScopeComplete:false,
    repositories:report.resources.repositories?(report.resources.repositories.repositories??[]).map(r=>({name:r.name,bytes:r.sizeBytes})):null,
  };save();console.log(JSON.stringify({receipt,...report.summary},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
