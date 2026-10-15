// Honest offline plan: unavailable evidence remains null, never a synthetic grant.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { capacityMeters, publishedCapacityCeilings, type CapacityEvidence } from '../collector/capacity-plan';
import { measurementCapacity, measurementExcluded, measurementMeters, type MeasurementPlan } from '../collector/measurement-capacity';
import { ledgerHash } from '../collector/measurement';
import { nextPacificReset } from '../collector/allowance-live';
const [stateFile,evidenceFile,imageDirectory,output]=process.argv.slice(2);
if(!stateFile||!evidenceFile||!imageDirectory||!/^\.local\/[a-z0-9-]+\.json$/.test(output??''))
  throw new Error('prepare-measurement-plan <state.json> <evidence.json> <local-image-directory> .local/<new-plan>.json');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const state=read(stateFile),evidence=read(evidenceFile),image=read(resolve(imageDirectory,'receipt.json'));
const ledger=JSON.parse(state.resources.ledger.fields.value.stringValue),release=read('.local/optimized-oct12-release.json'),now=Date.now();
const {loadDeploymentAccounting}=await import(pathToFileURL(resolve('scripts/deployment-accounting.mjs')).href);
const balance=loadDeploymentAccounting(release.deploymentPeriodStart,release.deploymentPeriodEnd);
const deploymentMap={cpuSeconds:'cpuSeconds',memoryGiBSeconds:'memoryGiBSeconds',artifactByteMonths:'artifactBytes',logBytes:'logBytes'};
const held=Object.fromEntries(Object.entries(deploymentMap).map(([k,v])=>[k,(balance.unresolved[v]??0)+(balance.uncertainty[v]??0)]));
const snapshotAt=Date.parse(state.at),evidenceAt=Date.parse(evidence.at);
const deployedContainer=state.resources.refreshmarket?.template?.containers?.[0];
const alreadyDeployed=deployedContainer?.image?.endsWith(`@${image.imageDigest}`)&&
  deployedContainer.env?.some((e:any)=>e.name==='MARKET_OPERATING_MODE'&&e.value==='measurement');
const p:MeasurementPlan={version:1,kind:'private-bazaar-measurement',id:`measure-${now}`,allowanceId:ledger.id,
  startsAt:now,deadline:Math.min(now,snapshotAt,evidenceAt)+15*60000,verifiedAt:Math.min(snapshotAt,evidenceAt),ledgerSha256:ledgerHash(ledger),
  evidence:`${stateFile}; ${evidenceFile}; recorded samples retain their original times`,
  isolation:{sourceSha256:image.sourceSha256,evidence:`Inspected source plus ${stateFile}`,verifiedAt:snapshotAt,
    schedulerPaused:state.resources.scheduler.state==='PAUSED',
    privateApi:!state.resources.marketapiIam.bindings?.some((b:any)=>b.members?.some((m:string)=>['allUsers','allAuthenticatedUsers'].includes(m))),
    privateCollector:!state.resources.refreshmarketIam.bindings?.some((b:any)=>b.members?.some((m:string)=>['allUsers','allAuthenticatedUsers'].includes(m))),
    ongoingCollectionDisabled:true,auctionsDisabled:true,ownerServicesUnused:true,emailDisabled:true,evaluationDisabled:true,backgroundJobsDisabled:true,
    authenticatedInvocation:evidence.resources.invocationPermissions?.permissions?.includes('run.routes.invoke')&&evidence.existingUserIdentity?.available
      ?'Existing owner has run.routes.invoke and an unexpired user ID token. Audience acceptance remains untested; only one reserved attempt is allowed.':'',
    ingressBound:''},
  exclusions:Object.fromEntries(measurementExcluded.map(k=>[k,'Dedicated collector path only: no browser, Hosting, Firebase user verification, owner database, Apps Script, email or portfolio evaluation. Paused marketApi is unchanged.'])),
  meters:{},upstream:{source:'https://api.hypixel.net/ documents these public endpoints but supplies no numeric anonymous entitlement or shared usage report',
    verifiedAt:now,scopeComplete:false,availableRequests:null,sharedUsageBound:null,reserve:.2},
  retainedDeployment:held,deployment:alreadyDeployed?{cpuSeconds:0,memoryGiBSeconds:0,artifactByteMonths:0,logBytes:0}:
    {cpuSeconds:10000,memoryGiBSeconds:10000,artifactByteMonths:image.artifactStorageHoldBytes,logBytes:16*1024**2},
  deploymentEvidence:'Hash-verified existing settlement plus every subsequent release hold; one proposed collector-only local application image, no Cloud Build'};
for(const [path,names]of [['shared/companion/portfolio-policy.ts',['PORTFOLIO_COLLECTION_ENABLED','PORTFOLIO_EVALUATION_ENABLED']],
  ['shared/automation-policy.ts',['BACKGROUND_JOBS_ENABLED','EMAIL_DELIVERY_ENABLED']]] as const)
  for(const name of names)if(!readFileSync(path,'utf8').includes(`export const ${name} = false;`))throw new Error(`Source gate changed: ${name}`);
if(!image.localRuntimeSmokeVerified||image.sourceSha256!==hash(readFileSync('market-functions/lib/index.cjs')))throw new Error('Image not verified against current source');
const diagnostics=readdirSync('.local').filter(n=>/^measurement-evidence-.*\.json$/.test(n)).map(n=>({path:`.local/${n}`,data:read(`.local/${n}`)}));
const diagnosticHolds=diagnostics.reduce((s:any,r:any)=>{for(const[k,v]of Object.entries(r.data.reservations??{}))s[k]=(s[k]??0)+Number(v);return s;},{});
const inspections=readdirSync('.local').filter(n=>/^measurement-state-.*\.json$/.test(n)).map(n=>({path:`.local/${n}`,data:read(`.local/${n}`)}));
for(const {data}of inspections) {
  // The legacy inspector reserved a total request cap, not classified costs.
  // Keep that cap in each possibly charged dimension; do not credit unused RPCs.
  diagnosticHolds.firestoreReads=(diagnosticHolds.firestoreReads??0)+data.reservedRequests;
  diagnosticHolds.storageClassA=(diagnosticHolds.storageClassA??0)+data.reservedRequests;
  diagnosticHolds.logBytes=(diagnosticHolds.logBytes??0)+1024**2;
  diagnosticHolds.responseBytes=(diagnosticHolds.responseBytes??0)+data.reservedRequests*4*1024**2;
}
for(const key of measurementMeters) {
  const sample=evidence.samples?.[key],legacy=deploymentMap[key as keyof typeof deploymentMap];
  const stored=legacy?balance.observed[legacy]:undefined;
  // Gauge sample time is original; aligned counter totals retain a separate tail.
  const gauge=key==='firestoreStorageBytes';
  const original=gauge?evidence.resources[key]?.timeSeries?.flatMap((s:any)=>s.points??[]).map((v:any)=>v.interval.endTime).sort().at(-1):sample?.latestOriginalSample;
  const m:CapacityEvidence={unit:capacityMeters[key],scope:'Required complete provider allowance scope; current measurements cover collector project only',
    scopeComplete:false,eligible:true,source:sample?`${evidenceFile}: ${key}; provisional operational metric, not billing settlement`:'No complete report available',
    periodStart:Date.parse(['firestoreReads','firestoreWrites','firestoreDeletes'].includes(key)?evidence.dailyStart:release.deploymentPeriodStart),
    periodEnd:['firestoreReads','firestoreWrites','firestoreDeletes'].includes(key)?nextPacificReset(now):ledger.expiresAt,
    measuredAt:original?Date.parse(original):0,allowance:publishedCapacityCeilings[key],
    measured:typeof sample?.value==='number'?Math.max(sample.value,stored??0):typeof stored==='number'?stored:null,
    reserved:(Object.hasOwn(ledger.monthlyLimits,key)||Object.hasOwn(ledger.dailyLimits,key)
      ?Math.max(ledger.monthlyReserved[key]??0,ledger.dailyReserved[key]??0)
      :Object.values(ledger.measurementRuns??{}).reduce((n:number,r:any)=>n+(r.reserved?.[key]??0),0))+(held[key]??0)+(diagnosticHolds[key]??0),
    fixedRemaining:null,uncertainty:0,safetyFraction:.25};
  // Preserve known settlement observation separately; it does not renew freshness.
  if(stored!==undefined)m.source+='; retained deployment settlement reported bound included once';
  p.meters[key]=m;
}
const files=[stateFile,evidenceFile,'.local/optimized-oct12-release.json',resolve(imageDirectory,'receipt.json'),
  'scripts/deployment-reservations.json','shared/companion/portfolio-policy.ts','shared/automation-policy.ts',...diagnostics.map(d=>d.path),...inspections.map(d=>d.path)];
const report={createdAt:new Date(now).toISOString(),plan:p,stateFile,imageDirectory,imageDigest:image.imageDigest,
  periodStart:release.deploymentPeriodStart,periodEnd:release.deploymentPeriodEnd,
  evidenceFiles:[...new Set(files)].map(path=>({path,sha256:hash(readFileSync(path))})),
  decision:measurementCapacity(p,ledger,now),diagnosticHolds,
  scope:'One initial Bazaar cycle with catalog/election dependencies; at most nine physical upstream attempts. 60s work, existing 90s Run timeout, no invocation retry, no browser/presence, no schedule resume.',
  deployment:{services:['refreshmarket'],measurementCodeOnly:true,measurementId:p.id,keepCollectionPaused:true,
    imageBytes:image.registryUploadBytes,artifactByteMonthHold:image.artifactStorageHoldBytes},
  steps:['Resolve each missing evidence field; preserve original observation times and all counters.',
    'Run private measurement --inspect. Only a passing result permits the changed collector image deployment.',
    'Use pausedCodeOnly + measurementCodeOnly collector release; keep marketapi on its current image.',
    'Refresh post-deployment evidence, preserving the absolute run deadline and all new release holds.',
    'Execute once through the existing user token. Grant and reservations use an exact-hash CAS without clearing the owner stop.',
    'Read completion, ledger and scheduler; retain failed/ambiguous holds. Do not infer billed compute from process CPU/wall time.'],
};
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({output,id:p.id,ready:report.decision.ready,problems:report.decision.problems,diagnosticHolds},null,2));
