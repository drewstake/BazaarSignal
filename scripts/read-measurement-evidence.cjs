// Bounded, GET/test-permissions only. No new scopes, probes to handlers,
// upstream collection, retries, changes to IAM, or missing-series zeros.
const fs=require('node:fs'), auth=require('firebase-tools/lib/auth');
const output=process.argv[2];
const stateFile=process.argv[3]??'.local/measurement-state-before.json';
if(!/^\.local\/[a-z0-9-]+\.json$/.test(output??''))throw new Error('Pass a new .local/<receipt>.json');
// The captured largest metric JSON was below 101 KiB. Bound future wire
// responses at 1 MiB and fail closed on growth; old receipts keep their 8 MiB holds.
const maxResponseBytes=1024**2;
const report={at:new Date().toISOString(),maxCalls:32,calls:0,maxResponseBytes,
  reservations:{monitoringReads:32000,firestoreReads:4,logBytes:1048576,responseBytes:32*maxResponseBytes},
  note:'Diagnostic bounds, not measured billing. Preserve even on failure; not a market ledger reset or settlement.',resources:{},errors:[]};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
(async()=>{
  const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw new Error('Existing login unavailable');
  const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  const current=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  const identityToken=current?.tokens?.id_token;
  const claims=identityToken?JSON.parse(Buffer.from(identityToken.split('.')[1],'base64url').toString()):null;
  report.existingUserIdentity={available:typeof identityToken==='string',expiresAt:claims?.exp?new Date(claims.exp*1000).toISOString():null};
  async function read(name,url,body){
    if(++report.calls>report.maxCalls)throw new Error('Evidence request cap');save();
    try{
      const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
      const chunks=[];let size=0;
      for await(const chunk of r.body){size+=chunk.length;if(size>maxResponseBytes)throw new Error('Response bound exceeded');chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString());
      if(!r.ok){report.errors.push({name,status:r.status,reason:data.error?.status});return;}
      if(data.nextPageToken)report.errors.push({name,reason:'Incomplete bounded page'});
      report.resources[name]=data;
    }catch(e){report.errors.push({name,reason:e.message});}finally{save();}
  }
  const project='bazaarsignal-510305', root=`projects/${project}/locations/us-central1`;
  await read('invocationPermissions',`https://run.googleapis.com/v2/${root}/services/refreshmarket:testIamPermissions`,{permissions:['run.routes.invoke','run.services.get','run.services.update']});
  const previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const identity=previous.resources.scheduler.httpTarget?.oidcToken?.serviceAccountEmail;
  if(identity)await read('identityPermissions',`https://iam.googleapis.com/v1/projects/-/serviceAccounts/${identity}:testIamPermissions`,{permissions:['iam.serviceAccounts.getOpenIdToken']});
  await read('projectIam',`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,{options:{requestedPolicyVersion:3}});
  const savedLedger=JSON.parse(previous.resources.ledger.fields.value.stringValue);
  const release=JSON.parse(fs.readFileSync('.local/optimized-oct12-release.json','utf8'));
  const start=release.deploymentPeriodStart;
  if(savedLedger.expiresAt!==Date.parse(release.deploymentPeriodEnd))throw new Error('Accounting period changed');
  const pacificDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
  let lo=Date.parse(report.at)-27*3600000,hi=Date.parse(report.at);const day=pacificDay(hi);
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(pacificDay(mid)===day)hi=mid;else lo=mid;}
  const dailyStart=new Date(hi).toISOString();
  const metrics=[
    ['firestoreReads','firestore.googleapis.com/document/read_ops_count',dailyStart],
    ['firestoreWrites','firestore.googleapis.com/document/write_ops_count',dailyStart],
    ['firestoreDeletes','firestore.googleapis.com/document/delete_ops_count',dailyStart],
    ['firestoreStorageBytes','firestore.googleapis.com/storage/data_and_index_storage_bytes',start],
    ['cpuSeconds','run.googleapis.com/container/cpu/allocation_time',start],
    ['memoryGiBSeconds','run.googleapis.com/container/memory/allocation_time',start],
    ['runRequests','run.googleapis.com/request_count',start],
    ['logBytes','logging.googleapis.com/billing/bytes_ingested',start],
    ['monitoringReads','monitoring.googleapis.com/billing/time_series_billed_for_queries_count',start],
    ['storageOperations','storage.googleapis.com/api/request_count',start],
    ['storageByteMonths','storage.googleapis.com/storage/total_byte_seconds',start],
    ['egressBytes','run.googleapis.com/container/network/sent_bytes_count',start],
  ];
  report.periodStart=start;report.dailyStart=dailyStart;
  for(const [name,type,since]of metrics){
    const gauge=name==='firestoreStorageBytes'||name==='storageByteMonths';
    // Fixed complete-hour boundaries keep repeated totals comparable. Raw
    // recent points below describe the unclosed tail without claiming settlement.
    const end=gauge?report.at:new Date(Math.floor(Date.parse(report.at)/3600000)*3600000).toISOString();
    const q=new URLSearchParams({filter:`metric.type="${type}"`,'interval.startTime':gauge?new Date(Date.parse(report.at)-15*60000).toISOString():since,'interval.endTime':end,pageSize:'1000',
      ...(gauge?{}:{'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':'ALIGN_SUM'})});
    await read(name,`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`);
  }
  // Alignment manufactures bucket endpoints. Preserve original sample times
  // separately; an aligned bucket ending now is never freshness evidence.
  for(const [name,type]of metrics.filter(([name])=>['firestoreReads','firestoreWrites','cpuSeconds','memoryGiBSeconds','storageOperations'].includes(name))){
    const q=new URLSearchParams({filter:`metric.type="${type}"`,'interval.startTime':dailyStart,'interval.endTime':report.at,pageSize:'1000'});
    await read(`${name}Raw`, `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`);
  }
  report.samples=Object.fromEntries(metrics.map(([name])=>{
    const data=report.resources[name], series=data?.timeSeries??[],points=series.flatMap(s=>s.points??[]);
    const values=points.map(p=>Number(p.value?.doubleValue??p.value?.int64Value));
    return [name,{state:!data?'unavailable':!points.length?'unreported':data.nextPageToken?'incomplete':'reported-project-only',
      series:series.length,points:points.length,latestAlignedBucketEnd:['firestoreStorageBytes','storageByteMonths'].includes(name)?null:points.map(p=>p.interval?.endTime).sort().at(-1)??null,
      latestOriginalSample:(['firestoreStorageBytes','storageByteMonths'].includes(name)?points:report.resources[`${name}Raw`]?.timeSeries?.flatMap(s=>s.points??[])??[]).map(p=>p.interval?.endTime).sort().at(-1)??null,
      earliest:points.map(p=>p.interval?.startTime??p.interval?.endTime).sort()[0]??null,
      // Gauge point sums are intentionally not exposed as byte-month usage.
      unit:name==='storageByteMonths'?'byte-seconds (not converted to byte-months)':name==='egressBytes'?'gross network bytes (not classified billable egress)':'provider metric units',
      value:name==='storageByteMonths'?null:points.length&&values.every(Number.isFinite)?(name==='firestoreStorageBytes'?Math.max(...values):values.reduce((a,b)=>a+b,0)):null}];
  }));
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({output,calls:report.calls,samples:report.samples,permissions:report.resources.invocationPermissions,
    identityPermissions:report.resources.identityPermissions,errors:report.errors},null,2));
})().catch(e=>{report.errors.push({reason:e.message});save();console.error(e.message);process.exitCode=1;});
