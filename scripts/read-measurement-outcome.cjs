// A bounded post-run read: one revision's measurements, quota state, ledger,
// private IAM and the still-paused scheduler. No probes or automatic retries.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
const [output,revision,option]=process.argv.slice(2),containmentOnly=option==='--containment-only';
if(option&&!containmentOnly)throw new Error('Unknown outcome option');
if(!/^\.local\/[a-z0-9-]+\.json$/.test(output??'')||!/^refreshmarket-[a-z0-9-]+$/.test(revision??''))throw new Error('Supply new receipt and exact revision');
const p='bazaarsignal-510305',root=`projects/${p}/locations/us-central1`;
const r={at:new Date().toISOString(),calls:0,maxCalls:containmentOnly?4:12,reservations:{monitoringReads:containmentOnly?0:5000,firestoreReads:4,logBytes:1048576,responseBytes:(containmentOnly?4:12)*4*1024**2},resources:{},errors:[]};
fs.writeFileSync(output,JSON.stringify(r),{flag:'wx'});const save=()=>fs.writeFileSync(output,JSON.stringify(r,null,2));
(async()=>{
 const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');if(!a)throw Error('Existing login unavailable');
 const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
 async function read(name,url,body){
  if(++r.calls>r.maxCalls)throw Error('Outcome request cap');save();
  try{const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   const parts=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>4*1024**2)throw Error('Response bound');parts.push(chunk);}
   const data=JSON.parse(Buffer.concat(parts).toString());if(!response.ok)throw Error(`HTTP ${response.status}: ${data.error?.status}; ${String(data.error?.message??'').slice(0,300)}`);
   if(data.nextPageToken)r.errors.push({name,reason:'Incomplete page'});r.resources[name]=data;
  }catch(e){r.errors.push({name,reason:e.message});}finally{save();}
 }
 await read('ledger',`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/marketCache/live-allowance`);
 await read('scheduler',`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`);
 for(const s of ['marketapi','refreshmarket'])await read(`${s}Iam`,`https://run.googleapis.com/v1/${root}/services/${s}:getIamPolicy`);
 if(!containmentOnly){
 await read('control',`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/marketCache/control`);
 await read('firestoreQuotas',`https://serviceusage.googleapis.com/v1beta1/projects/${p}/services/firestore.googleapis.com/consumerQuotaMetrics?view=FULL&pageSize=100`);
 for(const [name,type]of [['cpuSeconds','container/cpu/allocation_time'],['memoryGiBSeconds','container/memory/allocation_time'],['requests','request_count'],['networkBytes','container/network/sent_bytes_count'],['billableInstanceSeconds','container/billable_instance_time']]){
  const q=new URLSearchParams({filter:`metric.type="run.googleapis.com/${type}" AND resource.labels.revision_name="${revision}"`,'interval.startTime':'2026-10-13T03:47:00Z','interval.endTime':r.at,pageSize:'1000'});
  await read(name,`https://monitoring.googleapis.com/v3/projects/${p}/timeSeries?${q}`);
 }
 await read('revisionLogs','https://logging.googleapis.com/v2/entries:list',{resourceNames:[`projects/${p}`],filter:`resource.type="cloud_run_revision" AND resource.labels.revision_name="${revision}" AND timestamp>="2026-10-13T03:47:00Z"`,pageSize:100,orderBy:'timestamp desc'});
 }
 r.finishedAt=new Date().toISOString();save();
 const ledger=JSON.parse(r.resources.ledger?.fields?.value?.stringValue??'null');
 console.log(JSON.stringify({output,calls:r.calls,errors:r.errors,scheduler:r.resources.scheduler?.state,
  runs:Object.entries(ledger?.measurementRuns??{}).map(([id,v])=>({id,status:v.status,claimedAt:v.claimedAt,finishedAt:v.finishedAt,deadline:v.plan.deadline,observed:v.observed})),
  measurements:Object.fromEntries(['cpuSeconds','memoryGiBSeconds','requests','networkBytes','billableInstanceSeconds'].map(k=>{
   const d=r.resources[k],points=d?.timeSeries?.flatMap(s=>s.points??[])??[];
   return[k,{reported:points.length>0&&!d?.nextPageToken,sum:points.length?points.reduce((n,p)=>n+Number(p.value.doubleValue??p.value.int64Value),0):null,latest:points.map(p=>p.interval.endTime).sort().at(-1)??null}];
  }))},null,2));
})().catch(e=>{r.errors.push({reason:e.message});save();console.error(e.message);process.exitCode=1;});
