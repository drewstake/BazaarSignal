// Local operator only. No redeployment, recurring work or counter reset.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {measurementCapacity} from '../collector/measurement-capacity';
import {ledgerHash,verifyMeasurementContainment,type MeasurementState} from '../collector/measurement';
import {measurementPolicyTransition,policyTransitionHash,policyTransitionWrites} from './measurement-policy-transition';
const [planFile,controlEvidence,action,output]=process.argv.slice(2),restore=action==='--restore';
if(!planFile||!controlEvidence||!['--apply','--restore'].includes(action)||!/^\.local\/measurement-evidence-[a-z0-9-]+\.json$/.test(output??''))
  throw Error('configure-measurement-policy <reviewed-plan> <control-evidence/apply-receipt> --apply|--restore <new-evidence-receipt>');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),input=read(planFile),reference=read(controlEvidence);
const report:any={at:new Date().toISOString(),action,planFile,controlEvidence,calls:0,maxCalls:12,
  reservations:{firestoreReads:8,firestoreWrites:2,logBytes:1048576,responseBytes:1572864},errors:[]};
writeFileSync(output,JSON.stringify(report),{flag:'wx'});const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
try {
 const auth=createRequire(resolve('package.json'))('firebase-tools/lib/auth'),a=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
 if(!a)throw Error('Existing owner login unavailable');const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
 const network:typeof fetch=async(input,init)=>{if(++report.calls>report.maxCalls)throw Error('Request cap');save();return fetch(input,init);};
 const root='https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents';
 async function call(url:string,body?:unknown) {
   const r=await network(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   const parts:Uint8Array[]=[];let n=0;for await(const c of r.body as any){n+=c.length;if(n>131072)throw Error('Response bound');parts.push(c);}
   const d=JSON.parse(Buffer.concat(parts).toString());if(!r.ok)throw Error(`HTTP ${r.status}: ${d.error?.status}`);return d;
 }
 await verifyMeasurementContainment('bazaarsignal-510305',async()=>token,network);
 const c=await call(`${root}/marketCache/control`),l=await call(`${root}/marketCache/live-allowance`);
 const raw=c.fields.value.stringValue,ledger:MeasurementState=JSON.parse(l.fields.value.stringValue),now=Date.now();
 if(restore) {
   if(!reference.applied||reference.action!=='--apply'||reference.planFile!==planFile||
      (ledger.measurementRuns?.[input.plan.id]&&!['complete','failed','expired'].includes(ledger.measurementRuns[input.plan.id].status))||
      JSON.stringify([ledger.id,ledger.startsAt,ledger.expiresAt,ledger.stoppedAt,ledger.reason])!==JSON.stringify(reference.ledgerIdentity))
     throw Error('Restoration requires the applied policy, unchanged owner stop and no active run');
 } else {
   for(const e of input.evidenceFiles)if(policyTransitionHash(readFileSync(e.path,'utf8'))!==e.sha256)throw Error('Changed plan evidence');
   if(policyTransitionHash(raw)!==policyTransitionHash(reference.resources.control.fields.value.stringValue)||ledgerHash(ledger)!==input.plan.ledgerSha256)
     throw Error('Control or stopped ledger changed');
   const decision=measurementCapacity(input.plan,ledger,now);if(!decision.ready)throw Error(decision.problems.join('; '));
   // This apply AND restoration must be explicitly funded before either write.
   const holds=input.diagnosticHolds;
   if(!holds||holds.firestoreWrites<4)throw Error('Missing policy transition and restoration holds');
 }
 const next=measurementPolicyTransition(JSON.parse(raw),ledger,now,restore);
 report.beforeControl=c;report.beforeLedgerHash=ledgerHash(ledger);report.afterControl=next;
 report.ledgerIdentity=[ledger.id,ledger.startsAt,ledger.expiresAt,ledger.stoppedAt,ledger.reason];
 report.attempted=true;save();
 await call(`${root}:commit`,{writes:policyTransitionWrites(c,l,next)});report.applied=true;save();
 const afterControl=await call(`${root}/marketCache/control`),afterLedger=await call(`${root}/marketCache/live-allowance`);
 report.controlVerified=afterControl.fields.value.stringValue===JSON.stringify(next);
 report.ledgerPreserved=afterLedger.fields.value.stringValue===l.fields.value.stringValue;
 if(!report.controlVerified||!report.ledgerPreserved)throw Error('Post-transition state differs; preserve receipt');
 await verifyMeasurementContainment('bazaarsignal-510305',async()=>token,network);report.scheduler='PAUSED';
}catch(e){report.errors.push((e as Error).message);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,applied:report.applied,ledgerPreserved:report.ledgerPreserved,errors:report.errors},null,2));}
