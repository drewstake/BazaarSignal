// Reproducible supplement from the actual bounded inspections and account CSV.
// Local only. This does not settle, refund, mutate or activate an allowance.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {measurementCapacity,publicMeasurementEndpoints,type MeasurementEvidence} from '../collector/measurement-capacity';
const [baseFile,scopeFile,billingScopeFile,output]=process.argv.slice(2);
if(!baseFile||!scopeFile||!billingScopeFile||!/^\.local\/[a-z0-9-]+\.json$/.test(output??''))throw new Error('resolve-measurement-plan <base> <scope> <billing-scope> <new-output>');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report=read(baseFile),p=report.plan,scope=read(scopeFile),billingScope=read(billingScopeFile),state=read(report.stateFile);
const evidenceFile=report.evidenceFiles.find((e:any)=>e.path.includes('measurement-evidence-current'))?.path;
if(!evidenceFile)throw new Error('Current operational metrics required');
const evidence=read(evidenceFile),ledger=JSON.parse(state.resources.ledger.fields.value.stringValue);
const {parseBillingCsv}=await import(pathToFileURL(resolve('scripts/deployment-accounting.mjs')).href);
const rows=parseBillingCsv(readFileSync(billingScope.csv,'utf8'));
const now=Date.now(),reviewedAt=Math.min(Date.parse(scope.at),Date.parse(state.at),Date.parse(evidence.at));
if(scope.errors.length||!scope.documentInventory?.complete||!scope.resources.firestoreFields||scope.resources.firestoreFields.fields?.some((f:any)=>f.ttlConfig)||
  !billingScope.allProjects||!billingScope.allServices||!billingScope.allSkus||!billingScope.allLocations||!billingScope.exclusiveUseEvidence||
  billingScope.csvSha256!==hash(billingScope.csv))throw new Error('Incomplete scope, TTL, billing export or exclusive window');
const linked=state.resources.linkedProjects.projectBillingInfo??[];
if(state.resources.linkedProjects.nextPageToken||linked.length!==1||linked[0].projectId!=='bazaarsignal-510305'||linked[0].billingEnabled!==true)throw new Error('Billing membership changed');
const run=scope.resources.runServices.items??[];
if(run.length!==2||run.some((r:any)=>!['marketapi','refreshmarket'].includes(r.metadata.name))||(scope.resources.runJobs.items??[]).length)throw new Error('Unexpected compute consumer');
const locations=scope.resources.schedulerLocations.locations??[];
if(!locations.length||locations.some((l:any)=>!scope.resources[`scheduler/${l.locationId}`]))throw new Error('Incomplete Scheduler scope');
const jobs=locations.flatMap((l:any)=>scope.resources[`scheduler/${l.locationId}`].jobs??[]);
if(jobs.length!==1||jobs[0].state!=='PAUSED')throw new Error('Scheduler scope changed');
const buckets=scope.resources.loggingBuckets.buckets??[],sinks=scope.resources.loggingSinks.sinks??[];
if(buckets.length!==2||buckets.some((b:any)=>b.name.endsWith('/_Required')?b.retentionDays!==400:!b.name.endsWith('/_Default')||b.retentionDays!==30)||
  sinks.length!==2||sinks.some((s:any)=>!buckets.some((b:any)=>s.destination===`logging.googleapis.com/${b.name}`)))throw new Error('Unclassified log retention/export');
if(scope.resources.databases.databases?.length!==1||scope.resources.databases.databases[0].freeTier!==true)throw new Error('Database free allowance not established');
const billed=(id:string,unit:string,rounding=1)=>{
  const r=rows.filter((r:any)=>r['SKU ID']===id);
  if(r.length!==1||r[0]['Usage unit']!==unit)throw new Error(`Missing billing quantity ${id}`);
  const n=Number(r[0]['Usage amount'].replaceAll(',',''));
  if(!Number.isFinite(n)||n<0)throw new Error('Invalid billing quantity');return n+rounding;
};
const points=(key:string)=>{
  const r=scope.resources[key];if(!r||r.nextPageToken||!r.timeSeries?.length)throw new Error(`Unreported ${key}`);
  return r.timeSeries.flatMap((s:any)=>s.points??[]);
};
// Distributions with omitted proto3 mean are bounded by their populated buckets,
// never by treating a missing series as zero. Overflow/malformed data is refused.
const responseUpper=points('firestoreResponseBytes').reduce((n:number,p:any)=>{
  const d=p.value.distributionValue,count=Number(d?.count);
  if(!d||!Number.isFinite(count)||count<=0)throw new Error('Unknown response distribution');
  if(Number.isFinite(d.mean))return n+Math.ceil(count*d.mean)+count;
  const b=d.bucketOptions?.exponentialBuckets;
  if(!b||!Array.isArray(d.bucketCounts)||d.bucketCounts.reduce((s:number,v:string)=>s+Number(v),0)!==count)throw new Error('Unknown response buckets');
  return n+d.bucketCounts.reduce((s:number,v:string,i:number)=>{
    if(i>b.numFiniteBuckets&&Number(v)>0)throw new Error('Unbounded response bucket');
    return s+Number(v)*b.scale*b.growthFactor**i;
  },0);
},0);
const logBytes=points('loggingBytes').reduce((n:number,p:any)=>{const v=Number(p.value.doubleValue??p.value.int64Value);if(!Number.isFinite(v)||v<0)throw new Error('Unknown log quantity');return n+v;},0);
const storage=scope.resources.storageBytes;
if(storage?.nextPageToken||storage?.timeSeries?.length!==3)throw new Error('Incomplete Storage history');
const storagePeak=storage.timeSeries.reduce((n:number,s:any)=>n+Math.max(...s.points.map((p:any)=>Number(p.value.doubleValue??p.value.int64Value))),0);
if(!Number.isFinite(storagePeak))throw new Error('Unknown Storage gauge');
const currentStored=state.summary.buckets.reduce((n:number,b:any)=>{if(!b.complete)throw new Error('Incomplete retained versions');return n+b.bytes;},0);
const sample=(key:string)=>{const n=evidence.samples[key]?.value;if(!Number.isFinite(n))throw new Error(`Unreported operational metric ${key}`);return n;};
const csvAt=Date.parse(billingScope.reportedThrough);
const completeHour=Math.floor(Date.parse(evidence.at)/3600000)*3600000;
p.deadline=Math.min(p.deadline,reviewedAt+15*60000);
p.verifiedAt=reviewedAt;p.isolation.verifiedAt=reviewedAt;
p.isolation.ingressBound=`${billingScope.exclusiveUseEvidence}; global inventory has two private min-zero services and no jobs, Scheduler paused. Only one operator invocation plus the existing four control-request reserve. IAM-rejected requests are not billed: https://cloud.google.com/run/pricing`;
p.upstream={source:'https://api.hypixel.net/ documents these three public endpoints without API-key authorization. No numeric anonymous allowance is asserted. Availability/global throttling is unknown; any failure ends the one-shot.',
  verifiedAt:reviewedAt,scopeComplete:true,availableRequests:null,sharedUsageBound:null,reserve:.2,
  publicOneShot:{maxAttempts:3,retries:0,endpoints:publicMeasurementEndpoints,exclusiveUseEvidence:billingScope.exclusiveUseEvidence}};
const diag=report.diagnosticHolds;
const set=(key:string,measured:number,tail:number,fixed:number,source:string,at=completeHour)=>{
  const m:MeasurementEvidence=p.meters[key];
  Object.assign(m,{scopeComplete:true,scope:'Collector database/project; account-wide billing includes all three former/current linked projects where allowances are shared',
    source,periodStart:Math.min(m.periodStart,at),measuredAt:at,measured,uncertainty:tail,fixedRemaining:fixed,
    coverage:{verifiedAt:reviewedAt,coveredThrough:at,tailThrough:p.deadline,tailBound:tail,source:`${scopeFile}; exclusive window; full retained holds and explicit bounded tail below. Provisional quantities, not final invoice.`}});
};
set('cpuSeconds',Math.max(sample('cpuSeconds'),billed('AD70-830E-0384','second',.1)),10000,1000,'Complete-hour project Monitoring + whole-account billing upper rounding; all deployment/market holds additive');
set('memoryGiBSeconds',Math.max(sample('memoryGiBSeconds'),billed('769A-FA0B-B049','gibibyte second',.1)),10000,1000,'Complete-hour project Monitoring + whole-account billing upper rounding; all deployment/market holds additive');
set('runRequests',Math.max(sample('runRequests'),billed('92DF-0F0E-630F','count')),1000,100,'Billing + operational counter; private exclusive invocation window');
// Use all unclassified network output as a conservative upper bound. It is not
// relabeled billable Internet egress and is never subtracted from an old hold.
set('egressBytes',Math.max(sample('egressBytes'),billed('40B8-0628-A00F','gibibyte',.01)*1024**3),16*1024**2,1024**2,'Gross network-byte upper bound includes in-region traffic; no claim every byte is charged');
for(const key of ['firestoreReads','firestoreWrites'])set(key,sample(key),1000,100,'Complete-hour database operation series; diagnostic and old daily reservations retained');
set('firestoreStorageBytes',scope.documentInventory.documentAndIndexUpperBoundBytes,4*1024**2,4*1024**2,'Complete nine-document inventory times published document+index hard maxima; retained through period end',reviewedAt);
set('firestoreEgressBytes',Math.ceil(responseUpper*4),64*1024**2,Number(diag.responseBytes??0),'All Firestore API response-size distributions, multiplied by four for representation overhead; entire diagnostic wire caps additionally retained');
for(const key of ['storageClassA','storageClassB'])set(key,Math.max(sample('storageOperations'),billed(key==='storageClassA'?'4DBF-185F-A415':'7870-010B-2763','count')),500,100,'All Storage API operations conservatively charged to each class; account billing, diagnostic and legacy holds retained');
set('storageByteMonths',billed('E5F0-6A5D-7BAD','gibibyte month',.01)*1024**3,storagePeak*3,currentStored,'Rounded-up whole-account billing + three full periods of observed peak-byte uncertainty + all retained versions for a full period; not gauge integration',csvAt);
set('storageEgressBytes',billed('22EB-AAE8-FBCD','gibibyte',.01)*1024**3,256*1024**2,64*1024**2,'Account Storage transfer upper rounding, same-region retained bucket path; old gross holds remain additive',csvAt);
set('schedulerJobMonths',billed('A5D6-43A2-28A7','count')/31,0,1,'SKU counts are job-days/31. One paused job in all supported locations, reserved for another full month. https://cloud.google.com/scheduler/pricing',csvAt);
set('artifactByteMonths',p.meters.artifactByteMonths.measured,0,8*1024**2,'Existing hash-verified account settlement plus every unresolved/new rollout hold and retained uncertainty',csvAt);
set('logBytes',logBytes,16*1024**2,4*1024**2,'Project-wide ingested bytes, all old rollout log holds, new diagnostic holds and bounded tail');
set('monitoringReads',Math.max(sample('monitoringReads'),billed('6E35-67F5-C3C6','count')),10000,10000,'Account billing and Monitoring query counter; every diagnostic series reservation additive');
for(const [key,proof] of Object.entries({
  firestoreDeletes:'Complete TTL field inventory is empty. Measurement handler has no delete or cleanup path; exclusive writer window. Historical deletes remain unreported.',
  buildMinutes:'Application image built and startup-tested locally. Guarded release does not call Cloud Build; no build jobs are created. Historical build usage is unchanged and may be unknown.',
  artifactEgressBytes:'Release uploads local blobs and uses metadata HEAD, never downloads repository artifacts. Runtime/repository both us-central1: https://cloud.google.com/artifact-registry/pricing . Existing $0.000001 historical Internet charge is preserved, not waived or set to zero.',
  logRetentionByteMonths:'Complete sinks and buckets: only _Default 30 days and exempt _Required 400 days; no exported copies. https://cloud.google.com/products/observability/pricing',
}))Object.assign(p.meters[key],{scopeComplete:true,scope:'Complete inspected run path and resources',source:proof,
  measured:null,measuredAt:0,reserved:0,fixedRemaining:0,uncertainty:0,nonUse:{verifiedAt:reviewedAt,source:`${scopeFile}; ${proof}`}});
p.evidence+=`; ${scopeFile}; ${billingScopeFile}; preserved original provider times with separately funded tail bounds`;
for(const path of [baseFile,scopeFile,billingScopeFile,billingScope.csv])report.evidenceFiles.push({path,sha256:hash(path)});
report.accountingDerivation={reviewedAt,csvAt,completeHour,responseUpper,storagePeak,currentStored,logBytes,jobDays:billed('A5D6-43A2-28A7','count'),
  providerReports:'provisional/delayed; no reservation settlement or refunds',upstream:'Availability unknown; at most three public physical attempts, all nine held'};
report.decision=measurementCapacity(p,ledger,now);
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({output,id:p.id,decision:report.decision},null,2));
