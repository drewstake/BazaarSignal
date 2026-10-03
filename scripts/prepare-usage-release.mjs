import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const imageDirectory=process.argv[2];
const label=process.argv[3]??'usage-dashboard';
const reasons={'--recover-stopped-timeout':'The operation was aborted due to timeout','--recover-stopped-read-budget':'Free-tier operating budget reached: firestoreReads'};
const recoveryReason=reasons[process.argv[4]],recovery=!!recoveryReason;
if(process.argv[4]&&!recovery || process.argv.length>5)throw new Error('Unknown release option');
if(!/^usage-[a-z-]+$/.test(label))throw new Error('Invalid release label');
if(!imageDirectory||!resolve(imageDirectory).startsWith(resolve('.local/market-image-')))throw new Error('Pass the verified local image directory');
const receipt=read(`${imageDirectory}/receipt.json`),measure=read('.local/usage-dashboard-measured.json'),state=read('.local/live-state-latest.json');
const prior=read('.local/live-timing-fix-release.json'),ledger=state.ledger;
if(Date.now()-measure.generatedAt>1800000||Date.now()-Date.parse(state.at)>1800000||
  (recovery ? !Number.isFinite(ledger.stoppedAt)||ledger.reason!==recoveryReason||state.job.state!=='PAUSED' : ledger.stoppedAt!==undefined))throw new Error('Missing fresh active-period or explicit stopped recovery evidence');
const meter=id=>{const r=measure.rows.find(r=>r.id===id);if(r?.state!=='measured'||!Number.isFinite(r.measured))throw new Error(`Missing ${id} measurement`);return r.measured;};
if(measure.rows.find(r=>r.id==='images')?.measurementBasis!=='artifact-registry-sizeBytes')throw new Error('Image capacity must use repository storage-cost metadata');
const used=(id,key)=>Math.max(meter(id),prior.meters[key].used)+(ledger.monthlyReserved[key]??0);
const plan={project:'bazaarsignal-510305',operatingMode:'free-tier',updateExistingLive:true,services:recovery?['marketapi','refreshmarket']:['marketapi'],releaseId:`free-20261001-${label}`,
  ...(recovery?{recoverStopped:true,recoveryStopReason:recoveryReason,stoppedLedgerSha256:createHash('sha256').update(JSON.stringify(ledger)).digest('hex')}:{}),
  id:ledger.id,startsAt:new Date(ledger.startsAt).toISOString(),expiresAt:new Date(ledger.expiresAt).toISOString(),shutdownGrantExpiresAt:prior.shutdownGrantExpiresAt,
  imageDirectory,imageDigest:receipt.imageDigest,observedAt:measure.generatedAt,
  scopeEvidence:'.local/usage-source-inspection.json; .local/usage-meter-inspection.json',
  capacityEvidence:'.local/usage-dashboard-measured.json; Artifact Registry repository sizeBytes storage-cost metadata; no rollback image deletion',
  counterEvidence:'.local/usage-dashboard-measured.json; .local/live-state-latest.json; compute uses conservative max of prior/latest measurement plus current reservations',
  existingImageOverageDisclosed:false,
  meters:{
    cpuSeconds:{used:used('run-cpu','cpuSeconds'),hold:10000,headroom:10000,limit:180000},
    memoryGiBSeconds:{used:used('run-memory','memoryGiBSeconds'),hold:10000,headroom:10000,limit:360000},
    artifactBytes:{used:meter('images'),hold:receipt.artifactStorageHoldBytes,headroom:16*1024**2,limit:.5*1024**3},
    logBytes:{used:used('bazaarsignal-510305-logs','logBytes'),hold:16*1024**2,headroom:16*1024**2,limit:50*1024**3},
  }};
writeFileSync(`.local/${label}-predeploy-ledger.json`,JSON.stringify(state,null,2),{flag:'wx'});
writeFileSync(`.local/${label}-release.json`,JSON.stringify(plan,null,2),{flag:'wx'});
console.log(JSON.stringify(plan,null,2));
