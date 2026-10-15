// Read-only evidence supplement. Persist ceilings before issuing requests;
// absence of a metric is unknown, while a complete inventory can prove non-use.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
const output = process.argv[2];
const ttlOnly=process.argv[3]==='--ttl-only',gapsOnly=ttlOnly||process.argv[3]==='--gaps-only';
if(process.argv.length>4||(process.argv[3]&&!gapsOnly))throw new Error('Unknown scope option');
if (!/^\.local\/[a-z0-9-]+\.json$/.test(output ?? '')) throw new Error('Supply a new receipt path');
const p = 'bazaarsignal-510305', root = `projects/${p}`;
const maxCalls=ttlOnly?1:gapsOnly?2:96;
// Future inspections stop on oversized responses; prior larger holds stay retained.
const maxResponseBytes=1024**2;
const report = { at: new Date().toISOString(), calls: 0, maxCalls, maxResponseBytes,
  reservations: { firestoreReads: gapsOnly?4:512, storageClassA: gapsOnly?0:16, monitoringReads: ttlOnly?0:gapsOnly?1000:16000, logBytes: (gapsOnly?1:4)*1024**2, responseBytes: maxCalls*maxResponseBytes },
  resources: {}, errors: [] };
fs.writeFileSync(output, JSON.stringify(report), {flag:'wx'});
const save = () => fs.writeFileSync(output, JSON.stringify(report,null,2));
(async () => {
  const account = auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if (!account) throw new Error('Existing owner login unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  async function read(name,url,body) {
    if (++report.calls>report.maxCalls) throw new Error('Scope request cap'); save();
    try {
      const r=await fetch(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const chunks=[];let size=0;
      for await(const c of r.body){size+=c.length;if(size>maxResponseBytes)throw new Error('Response bound');chunks.push(c);}
      const d=JSON.parse(Buffer.concat(chunks).toString());
      if(!r.ok)throw new Error(`HTTP ${r.status}: ${d.error?.status}; ${String(d.error?.message??'').slice(0,400)}`);
      // Resource configuration only; never persist environment secrets.
      const redact=v=>{if(v&&typeof v==='object')for(const k of Object.keys(v))if(k==='env')delete v[k];else redact(v[k]);};redact(d);
      if(d.nextPageToken||d.metadata?.continue||d.unreachable?.length)report.errors.push({name,reason:'Incomplete scope'});
      report.resources[name]=d;return d;
    }catch(e){report.errors.push({name,reason:e.message});}finally{save();}
  }
  if(!gapsOnly){
  await read('billingProjects','https://cloudbilling.googleapis.com/v1/billingAccounts/012803-EA91BE-8DCD32/projects');
  await read('runServices',`https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${p}/services?limit=1000`);
  await read('runJobs',`https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${p}/jobs?limit=1000`);
  await read('loggingBuckets',`https://logging.googleapis.com/v2/${root}/locations/-/buckets?pageSize=1000`);
  await read('loggingSinks',`https://logging.googleapis.com/v2/${root}/sinks?pageSize=1000`);
  const db=`https://firestore.googleapis.com/v1/${root}/databases/(default)`;
  await read('databases',`https://firestore.googleapis.com/v1/${root}/databases`);
  await read('firestoreFields',`${db}/collectionGroups/-/fields?filter=ttlConfig%3A*`);
  const cols=await read('collections',`${db}/documents:listCollectionIds`,{pageSize:100});
  report.documentInventory={complete:!!cols&&!cols.nextPageToken,documents:[]};
  const queue=(cols?.collectionIds??[]).map(id=>`${db}/documents/${encodeURIComponent(id)}`);
  while(queue.length&&report.documentInventory.documents.length<256){
    const path=queue.shift();
    const docs=await read(`documents/${path.split('/documents/')[1]}`,`${path}?pageSize=256&showMissing=true&mask.fieldPaths=__name__`);
    if(!docs||docs.nextPageToken){report.documentInventory.complete=false;break;}
    for(const doc of docs.documents??[]){
      report.documentInventory.documents.push({name:doc.name,createTime:doc.createTime,updateTime:doc.updateTime});
      const children=await read(`children/${doc.name}`,`https://firestore.googleapis.com/v1/${doc.name}:listCollectionIds`,{pageSize:100});
      if(!children||children.nextPageToken)report.documentInventory.complete=false;
      for(const id of children?.collectionIds??[])queue.push(`https://firestore.googleapis.com/v1/${doc.name}/${encodeURIComponent(id)}`);
    }
  }
  if(queue.length)report.documentInventory.complete=false;
  if(report.documentInventory.complete)report.documentInventory.documentAndIndexUpperBoundBytes=report.documentInventory.documents.length*(9*1024**2+4096);
  const locations=await read('schedulerLocations',`https://cloudscheduler.googleapis.com/v1/${root}/locations?pageSize=100`);
  if(locations&&!locations.nextPageToken&&(locations.locations?.length??100)<=45){
    for(const l of locations.locations??[])await read(`scheduler/${l.locationId}`,`https://cloudscheduler.googleapis.com/v1/${l.name}/jobs?pageSize=100`);
  }else report.errors.push({name:'scheduler',reason:'Location inventory incomplete within cap'});
  }else await read('firestoreFields',`https://firestore.googleapis.com/v1/${root}/databases/(default)/collectionGroups/-/fields?filter=ttlConfig%3A*`);
  const since='2026-10-01T07:00:00Z',end=new Date(Math.floor(Date.parse(report.at)/3600000)*3600000).toISOString();
  for(const [name,type,extra] of [
    ['firestoreResponseBytes','serviceruntime.googleapis.com/api/response_sizes',' AND resource.labels.service="firestore.googleapis.com"'],
    ['loggingBytes','logging.googleapis.com/billing/bytes_ingested',''],
    ['storageBytes','storage.googleapis.com/storage/total_bytes',''],
  ]){
    if(ttlOnly||(gapsOnly&&name!=='storageBytes'))continue;
    const q=new URLSearchParams({filter:`metric.type="${type}"${extra}`,'interval.startTime':since,'interval.endTime':end,pageSize:'1000'});
    if(name==='loggingBytes'){q.set('aggregation.alignmentPeriod','3600s');q.set('aggregation.perSeriesAligner','ALIGN_SUM');}
    // Daily maxima bound retained bytes; never sum gauges as monthly usage.
    if(name==='storageBytes'){q.set('aggregation.alignmentPeriod','86400s');q.set('aggregation.perSeriesAligner','ALIGN_MAX');}
    await read(name,`https://monitoring.googleapis.com/v3/${root}/timeSeries?${q}`);
  }
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({output,calls:report.calls,errors:report.errors,documentInventory:report.documentInventory,
    schedulerJobs:Object.entries(report.resources).filter(([k])=>k.startsWith('scheduler/')).flatMap(([,v])=>v.jobs??[]).map(j=>({name:j.name,state:j.state})),
    logBuckets:report.resources.loggingBuckets?.buckets?.map(b=>({name:b.name,retentionDays:b.retentionDays})),
    series:Object.fromEntries(['firestoreResponseBytes','loggingBytes','storageBytes'].map(k=>[k,report.resources[k]?.timeSeries?.length??null]))},null,2));
})().catch(e=>{report.errors.push({reason:e.message});save();console.error(e.message);process.exitCode=1;});
