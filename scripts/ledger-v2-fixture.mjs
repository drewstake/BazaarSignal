// Synthetic control plane only: no credentials, timers, collection or mail APIs.
import { Migration, CLOUD_ROOT, SERVICES, JOBS, END, digest, stateHash } from './ledger-v2-migration.mjs';
import {compileRequest,compilePinRequest} from './ledger-v2-requests.mjs';
const clone = value => structuredClone(value);
const fakeDigest = n => `sha256:${n.repeat(64)}`;
export const fixtureArtifact = (n='a') => ({imageDigest:fakeDigest(n),localRuntimeSmokeVerified:true,
  ledgerFormats:[1,2],writesLedgerVersion:2,hostingSha256:n.repeat(64),appsScriptSha256:(n==='a'?'c':'d').repeat(64)});
export function migrationFixture(artifacts={candidate:fixtureArtifact('a'),fallback:fixtureArtifact('b')}) {
  let now=Date.parse('2026-10-23T14:04:00Z'), version=1;
  const legacyRaw='{"id":"offline-legacy","stoppedAt":1}';
  const ledger={version:1,id:'paid-202610',startsAt:Date.parse('2026-10-13T21:32:23.818Z'),expiresAt:END,
    limitUsd:5,stopUsd:4.5,reservedUsd:1,reserved:{cpuSeconds:10,firestoreReads:1},observed:{firestoreReads:1},
    admissions:{'prior-offline-event':{at:now-900000,finished:true}},legacyLedgerSha256:digest(legacyRaw)};
  function service(name) {
    const revision=`${CLOUD_ROOT}/services/${name}/revisions/old`;
    return {name:`${CLOUD_ROOT}/services/${name}`,etag:'service-1',iam:{etag:'iam-1',bindings:name==='marketapi'?
      [{role:'roles/run.invoker',members:['allUsers']},{role:'roles/viewer',members:['user:fixture@example.invalid']}]:[]},
      latestReadyRevision:revision,latestCreatedRevision:revision,readyDigest:fakeDigest('0'),reconciling:false,
      terminalCondition:{state:'CONDITION_SUCCEEDED'},traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}],
      scaling:{maxInstanceCount:1},template:{revision,scaling:{maxInstanceCount:1},timeout:name==='marketapi'?'15s':'90s',
        maxInstanceRequestConcurrency:name==='marketapi'?2:1,
        serviceAccount:`${name==='marketapi'?'market-reader':'market-collector'}@bazaarsignal-510305.iam.gserviceaccount.com`,
        containers:[{image:`fixture.invalid/image@${fakeDigest('0')}`,env:[{name:'MARKET_OPERATING_MODE',value:'paid-budget'},
          {name:'MARKET_LIVE_ID',value:'free-20261001'},{name:'MARKET_LIVE_END',value:new Date(END).toISOString()}],
          resources:{limits:{cpu:'1',memory:'1Gi'},cpuIdle:true,startupCpuBoost:false},startupProbe:{tcpSocket:{port:8080}}}]} };
  }
  const state={at:now,ledger:{value:ledger,version:'ledger-1'},legacyRaw,controlHash:digest('old-control'),receiptsHash:digest([]),receiptCount:0,
    services:Object.fromEntries(SERVICES.map(n=>[n,service(n)])),jobs:Object.fromEntries(JOBS.map(n=>[n,{
      name:`${CLOUD_ROOT}/jobs/${n}`,state:'ENABLED',schedule:n===JOBS[0]?'*/15 * * * *':'59 4 * * *',timeZone:'Etc/UTC',attemptDeadline:'90s',
      retryConfig:{retryCount:0,maxRetryDuration:'0s'},httpTarget:{httpMethod:'POST',uri:'https://refreshmarket-k5a64sgi2q-uc.a.run.app/',
        oidcToken:{audience:'https://refreshmarket-k5a64sgi2q-uc.a.run.app/',serviceAccountEmail:'market-collector@bazaarsignal-510305.iam.gserviceaccount.com'}}}])),
    worker:{paused:false,etag:'worker-1',sourceDigest:'e'.repeat(64),deploymentDigest:'e'.repeat(64),
      otherPropertiesHash:digest('slots-cursors-delivery-receipts'),triggerHash:digest('unchanged-existing-trigger'),activeExecutions:0},
    hosting:{digest:'f'.repeat(64),etag:'hosting-1'},
    barrier:{unknownWriters:[],effectiveAccessVerified:true,authenticatedCallersStopped:true,activeApi:0,activeCollector:0,activeAdmin:0}};
  const plan={kind:'ledger-v2-maintenance',productionExecutionEnabled:false,project:'bazaarsignal-510305',activePaidUpdate:true,
    operatingMode:'paid-budget',updateExistingLive:true,id:ledger.id,releaseId:'fixture-ledger-v2',servicePeriodId:'free-20261001',
    services:['marketapi','refreshmarket'],startsAt:new Date(ledger.startsAt).toISOString(),expiresAt:new Date(END).toISOString(),
    legacyLedgerSha256:ledger.legacyLedgerSha256,budgetUsd:5,applicationStopUsd:4.5,fixedReserveUsd:1,paidRolloutReserveUsd:.5,
    imageDigest:artifacts.candidate.imageDigest,candidate:clone(artifacts.candidate),fallback:clone(artifacts.fallback),
    observedAt:now,remainingAdmissionsRequired:1000,maxBillingAgeMs:24*3600000,
    meters:{cpuSeconds:{used:10,hold:10000,limit:180000},memoryGiBSeconds:{used:0,hold:10000,limit:360000},
      artifactBytes:{used:0,hold:180000000,limit:1024**3},logBytes:{used:0,hold:16*1024**2,limit:50*1024**3}}};
  const records=[],journals=[],requests=[];
  const hooks={beforeApply:undefined,afterApply:undefined,onRead:undefined,onWait:undefined};
  const io={kind:'isolated-fixture',dataset:'fixture-ledger-v2',now:()=>now,
    async read(){hooks.onRead?.(state);state.at=now;return clone(state);},
    async wait(ms){now+=ms;hooks.onWait?.(state);},
    async saveJournal(j){journals.push(j);},
    async apply(a){
      hooks.beforeApply?.(a,state);
      if(stateHash(state)!==a.expectedStateHash)throw Object.assign(Error('CAS rejected'),{code:'REJECTED'});
      requests.push(compileRequest(a,state));
      records.push(clone(a));const next=String(++version);
      switch(a.kind){
        case 'worker-pause': if(state.worker.etag!==a.etag)throw Error('Worker version drift');state.worker.paused=a.value;state.worker.etag=next;break;
        case 'job-state':state.jobs[a.name].state=a.value;break;
        case 'api-policy':if(state.services.marketapi.iam.etag!==a.etag)throw Error('IAM etag drift');state.services.marketapi.iam={...clone(a.value),etag:next};break;
        case 'reserve':if(state.ledger.version!==a.updateTime)throw Error('Ledger CAS drift');state.ledger={value:clone(a.value),version:next};break;
        case 'deploy': {
          const s=state.services[a.name];if(s.etag!==a.etag)throw Error('Service etag drift');
          const revision=`${s.name}/revisions/fixture-${next}`;s.etag=next;s.latestCreatedRevision=revision;s.latestReadyRevision=revision;
          s.readyDigest=a.value;s.template.revision=revision;s.template.containers[0].image=`fixture.invalid/image@${a.value}`;
          const pin=compilePinRequest(a.name,a.value,s);requests.push(pin);s.traffic=pin.body.traffic;break;
        }
        case 'worker-code':if(state.worker.etag!==a.etag)throw Error('Worker CAS drift');state.worker.sourceDigest=a.value;state.worker.deploymentDigest=a.value;state.worker.etag=next;break;
        case 'hosting':if(state.hosting.etag!==a.etag)throw Error('Hosting CAS drift');state.hosting.digest=a.value;state.hosting.etag=next;break;
        default:throw Error('Unsupported fixture action');
      }
      hooks.afterApply?.(a,state);return {name:`fixture-operation-${next}`,done:true};
    }};
  function naturalEvidence() {
    if(state.jobs[JOBS[0]].state!=='ENABLED')throw Error('Fixture schedule is paused');
    // Synthetic evidence, not a handler invocation. Application semantics are
    // tested separately through each staged PaidLedger and offline Google store.
    now=Math.ceil(now/900000)*900000+7000;
    const eventId=`fixture-scheduled-event:${now}`, b=state.ledger.value;
    b.admissionCount=(b.admissionCount??Object.keys(b.admissions).length)+1;b.version=2;
    b.reservedUsd+=.003;b.reserved.firestoreWrites=(b.reserved.firestoreWrites??0)+4;
    b.observed.firestoreReads+=3;b.lastCollectorAt=now;
    state.ledger.version=String(++version);state.receiptCount++;state.receiptsHash=digest(eventId);state.controlHash=digest(now);
    return {kind:'natural-schedule',job:JOBS[0],revision:state.services.refreshmarket.latestReadyRevision,eventId,
      at:now,sampleAt:now-1000,snapshotComplete:true,receipt:{version:1,budget:b.id,invocation:eventId,at:now,finished:true}};
  }
  const coordinator=new Migration(plan,io);
  return {state,plan,io,hooks,records,journals,requests,coordinator,naturalEvidence,advance:ms=>{now+=ms;}};
}
