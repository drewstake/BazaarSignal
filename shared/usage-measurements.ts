import type { UsageRow } from './usage-dashboard';
// Calendar boundaries follow Pacific billing/Firestore days, including DST.
export function pacificMidnight(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let result = target + 8 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(result);
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    result += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return result;
}
export function periods(now: number) {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now), [y,m,d] = day.split('-').map(Number);
  const iso = (date: Date) => date.toISOString().slice(0,10);
  return {day:[pacificMidnight(day),pacificMidnight(iso(new Date(Date.UTC(y,m-1,d+1))))],
    month:[pacificMidnight(`${day.slice(0,7)}-01`),pacificMidnight(iso(new Date(Date.UTC(y,m,1))))]};
}
export function allowanceMath(value: number | null, allowance: number | null, start: number, end: number, at: number, gauge=false) {
  const valid = value !== null && Number.isFinite(value) && value >= 0;
  const limit = allowance !== null && Number.isFinite(allowance) && allowance > 0;
  return {percent:valid && limit ? value / allowance * 100 : null,
    remaining:valid && limit ? Math.max(0,allowance-value) : null,
    projected:valid && !gauge && end > start && at-start >= 3600_000 && at <= end ? value*(end-start)/(at-start) : null};
}

type Measurement = {value:number|null;at:number|null;state:UsageRow['state'];comparable?:boolean;coverage?:UsageRow['coverage'];coverageDetail?:string};
export function missingMeasurement(data:any):Measurement {
  const code=data?.status, reason=data?.reason;
  const coverage:UsageRow['coverage']=reason==='SERVICE_DISABLED'||code===404?'setup':code===401||code===403?'permission':data?.nextPageToken?'incomplete':data?.error?'error':'delay';
  return {value:null,at:null,state:coverage==='delay'?'not-reported':'unavailable',coverage,coverageDetail:{
    setup:'The API or measurement source is not configured. No service was enabled.',
    permission:'The reporting service lacks read permission for this source.',
    incomplete:'The response exceeded the bounded page limit; a partial total is not shown.',
    error:'The source could not be read. Retry after the shared cache interval.',
    delay:'Google returned no samples for this period. This can mean reporting delay or no recorded activity; it does not verify zero.',
    'not-exposed':'Google does not expose this quota through an API.',
  }[coverage]};
}

export function buildMeasurement(pages:any[],start:number,end:number,now:number):Measurement {
  for(const page of pages)if(page.error||page.nextPageToken)return missingMeasurement(page);
  let minutes=0,comparable=true;
  for(const build of pages.flatMap(p=>p.builds??[])) {
    const from=Date.parse(build.startTime),to=Date.parse(build.finishTime);
    if(!Number.isFinite(from)) {
      if(['QUEUED','PENDING','CANCELLED','EXPIRED'].includes(build.status)&&!build.finishTime)continue;
      return missingMeasurement({error:'Missing build timing'});
    }
    if(from>=end || (Number.isFinite(to)&&to<=start))continue;
    if(!Number.isFinite(to)||to<from)return missingMeasurement({error:'Incomplete build timing'});
    if(build.options?.pool?.name||build.options?.workerPool||!['UNSPECIFIED','E2_STANDARD_2'].includes(build.options?.machineType??'UNSPECIFIED'))comparable=false;
    minutes+=(Math.min(to,end)-Math.max(from,start))/60000;
  }
  return {value:minutes,at:now,state:'measured',comparable};
}

export function mailMeasurement(doc:any,now:number):Measurement {
  if(doc.error)return missingMeasurement(doc);
  let worker:any;try{worker=JSON.parse(doc.fields?.json?.stringValue);}catch{return missingMeasurement({status:404});}
  const at=worker.monitor?.lastAttempt,remaining=worker.monitor?.quota;
  if(typeof at!=='number'||at>now||now-at>30*60000)return {...missingMeasurement({}),coverageDetail:'The saved MailApp reading is missing or older than 30 minutes. The existing alert worker will update it; dashboard refresh never runs the worker.'};
  if(typeof remaining!=='number'||!Number.isInteger(remaining)||remaining<0||remaining>100)return missingMeasurement({error:'Invalid quota'});
  return {value:100-remaining,at,state:'measured'};
}

export function repositoryStorageMeasurement(data:any,now:number):Measurement {
  if(data.error)return missingMeasurement(data);
  // REST int64 fields are strings. Missing/invalid storage must never become zero.
  if(typeof data.sizeBytes !== 'string' || !/^\d+$/.test(data.sizeBytes) || !Number.isSafeInteger(Number(data.sizeBytes)))
    return {...missingMeasurement({error:'Invalid repository storage'}),coverageDetail:'Google did not return a valid repository storage total. Missing storage is not zero.'};
  return {value:Number(data.sizeBytes),at:now,state:'measured'};
}

interface Spec { id:string; project:string; resource:string; purpose:string; unit:string;
  metric?:string; gauge?:boolean; daily?:boolean; limit?:number; scope?:string; allowance?:string;
  key?:string; filter?:string; divisor?:number; note?:string; url?:string }
const main='bazaarsignal', cloud='bazaarsignal-510305', GiB=1024**3;
const free='https://docs.cloud.google.com/free/docs/free-cloud-features#free-tier-usage-limits';
const run='https://cloud.google.com/run/pricing';
export function usageSpecs():Spec[] {
  const specs:Spec[] = [
    {id:'run-requests',project:cloud,resource:'Cloud Run requests',purpose:'Shared cache API and scheduled collector',unit:'requests',metric:'run.googleapis.com/request_count',limit:2_000_000,key:'runRequests',url:run},
    {id:'run-cpu',project:cloud,resource:'Cloud Run CPU',purpose:'Collector and API allocated compute time',unit:'vCPU-s',metric:'run.googleapis.com/container/cpu/allocation_time',limit:180_000,key:'cpuSeconds',url:run,note:'Operational allocation time; billing rounding, startup and credits can differ. Request-based free tier.'},
    {id:'run-memory',project:cloud,resource:'Cloud Run memory',purpose:'Collector and API allocated memory time',unit:'GiB-s',metric:'run.googleapis.com/container/memory/allocation_time',limit:360_000,key:'memoryGiBSeconds',url:run,note:'Operational allocation time in GiB-seconds; not a cost record.'},
    {id:'run-network',project:cloud,resource:'Cloud Run bandwidth',purpose:'Cache responses and outgoing provider requests',unit:'bytes',metric:'run.googleapis.com/container/network/sent_bytes_count',limit:GiB,key:'egressBytes',url:run,note:'All observed sent bytes compared conservatively with 1 GiB eligible North American Internet transfer. Destination eligibility is unverified; internal traffic may be free.'},
    {id:'storage-a',project:cloud,resource:'Cloud Storage Class A',purpose:'Snapshot uploads and cleanup listings',unit:'operations',metric:'storage.googleapis.com/api/request_count',filter:'metric.labels.method = one_of("WriteObject", "ListObjects")',limit:5000,key:'storageClassA',note:'Measured WriteObject + ListObjects calls; other Class A methods and other account projects are not included. Remaining is an upper bound.'},
    {id:'storage-b',project:cloud,resource:'Cloud Storage Class B',purpose:'Read cached snapshots',unit:'operations',metric:'storage.googleapis.com/api/request_count',filter:'metric.labels.method = one_of("ReadObject", "GetObject", "GetBucket")',limit:50000,key:'storageClassB',note:'Measured read/get calls; other Class B methods and other account projects are not included. Remaining is an upper bound.'},
    {id:'storage-capacity',project:cloud,resource:'Cloud Storage capacity',purpose:'Private compressed market snapshots and retained objects',unit:'bytes',metric:'storage.googleapis.com/storage/total_bytes',gauge:true,limit:5*GiB,allowance:'5 GiB-month eligible regional Standard storage',note:'Latest capacity, not integrated GiB-month billing. Eligible US regions only; soft-deleted storage may be reported separately.'},
    {id:'storage-transfer',project:cloud,resource:'Cloud Storage transfer',purpose:'Snapshot downloads to the collector and API',unit:'bytes',metric:'storage.googleapis.com/network/sent_bytes_count',limit:100*GiB,key:'storageEgressBytes',note:'Gross sent bytes, not billed Internet egress. Same-region bucket-to-Run transfer is internal. 100 GiB applies to eligible North America destinations, excluding China/Australia. The app reserves internal gross reads separately.'},
    {id:'scheduler',project:cloud,resource:'Cloud Scheduler',purpose:'Existing scheduled collector job',unit:'jobs',gauge:true,limit:3,note:'Regional inventory; billing allowance covers 3 jobs across the billing account. Paused jobs still count.'},
    {id:'builds',project:cloud,resource:'Cloud Build',purpose:'Build time in the deployment regions',unit:'minutes',limit:2500,url:'https://cloud.google.com/build/pricing',note:'Measured elapsed build time in us-central1 and global, including failed builds and period overlaps. Other regions/projects are not covered. The 2,500-minute allowance applies only to eligible e2-standard-2 default-pool builds; billing rounding and machine eligibility can differ. No usage-rate projection for irregular builds.'},
    {id:'images',project:cloud,resource:'Container images',purpose:'Artifact Registry deployment images',unit:'bytes',gauge:true,limit:.5*GiB,allowance:'0.5 GiB-month storage',url:'https://cloud.google.com/artifact-registry/pricing',note:'Repository gcf-artifacts in us-central1. Google documents repository sizeBytes as the storage total used to calculate storage costs. Includes retained image layers and build caches; shared layers are not summed per image. Current capacity is not month-average storage or an actual charge.'},
    {id:'hosting-storage',project:main,resource:'Hosting storage',purpose:'Website assets and retained releases',unit:'bytes',metric:'firebasehosting.googleapis.com/storage/total_bytes',gauge:true,limit:10*1000**3,scope:'Per Firebase project',url:'https://firebase.google.com/pricing'},
    {id:'hosting-transfer',project:main,resource:'Hosting transfer',purpose:'Website page and asset downloads',unit:'bytes',metric:'firebasehosting.googleapis.com/network/sent_bytes_count',limit:10*GiB,scope:'Per Firebase project · Spark',url:'https://firebase.google.com/docs/hosting/usage-quotas-pricing',note:'10 GiB monthly Spark enforcement limit verified with the project monthly_sent_limit metric. Published Blaze no-cost pricing uses 360 MB/day; this project has billing disabled.'},
    {id:'auth',project:main,resource:'Google authentication',purpose:'Signed-in accounts and private access',unit:'new active users',metric:'identitytoolkit.googleapis.com/usage/monthly_new_signin_count',scope:'Per Firebase project',allowance:'Google sign-in is no-cost; provider/rate quotas also apply',note:'Monthly new-active-user events where reported. Not a count of stored users.',url:'https://firebase.google.com/pricing'},
  ];
  for (const project of [main,cloud]) {
    for (const [kind,limit,key] of [['read',50000,'firestoreReads'],['write',20000,'firestoreWrites'],['delete',20000,'firestoreDeletes']] as const)
      specs.push({id:`${project}-${kind}`,project,resource:`Firestore ${kind}s`,purpose:project===main?'Private saved items, preferences and alert records':'Collector coordination, allowance ledger and snapshot pointers',unit:'operations',metric:`firestore.googleapis.com/document/${kind}_ops_count`,daily:true,limit,scope:'Per project, one eligible database',key:project===cloud?key:undefined});
    specs.push({id:`${project}-db`,project,resource:'Firestore storage',purpose:project===main?'Private user data and alerts':'Shared coordination and cache pointers',unit:'bytes',metric:'firestore.googleapis.com/storage/data_and_index_storage_bytes',gauge:true,limit:GiB,scope:'Per project, one eligible database',note:'Latest reported documents and indexes; typically delayed.'});
    specs.push({id:`${project}-logs`,project,resource:'Cloud Logging',purpose:'Application and infrastructure logs',unit:'bytes',metric:'logging.googleapis.com/billing/bytes_ingested',limit:50*GiB,scope:'Per project',key:project===cloud?'logBytes':undefined});
  }
  for (const [id,resource,unit,limit,note] of [
    ['script-runtime','Apps Script trigger runtime','minutes',90,'Consumer account quota resets 24 hours after the first request. The existing 70-minute/day worker safeguard excludes lightweight off-slot ticks. Total Google runtime is not available through this API.'],
    ['script-fetch','Apps Script URL Fetch','calls',20000,'Consumer sender account, shared across its scripts. Google provides no remaining URL Fetch quota API.'],
    ['script-mail','Apps Script email recipients','recipients',100,'Allowance consumed is 100 minus the remaining recipient quota reported by MailApp and saved by the existing worker. Shared across the consumer sender account. Google does not expose the exact quota reset time.'],
  ] as const) specs.push({id,project:main,resource,purpose:'Email alert backend',unit,limit,daily:true,scope:'Per sender account; rolling 24-hour reset',note,url:'https://developers.google.com/apps-script/guides/services/quotas'});
  return specs;
}

export function summarizeSeries(data:any, gauge:boolean, divisor=1):Measurement {
  if (data.error || data.nextPageToken) return missingMeasurement(data);
  const series=data.timeSeries;
  if (!Array.isArray(series) || !series.length) return missingMeasurement({});
  let value=0, at=Infinity;
  for (const s of series) {
    const points=[...(s.points??[])].sort((a,b)=>Date.parse(b.interval.endTime)-Date.parse(a.interval.endTime));
    if (!points.length) return missingMeasurement({});
    at=Math.min(at,Date.parse(points[0].interval.endTime));
    for (const p of gauge?points.slice(0,1):points) {
      const n=Number(p.value?.int64Value??p.value?.doubleValue??NaN);
      if (!Number.isFinite(n) || n<0 || !Number.isFinite(at)) return missingMeasurement({error:'Invalid sample'});
      value+=n/divisor;
    }
  }
  return {value,at,state:'measured'};
}
