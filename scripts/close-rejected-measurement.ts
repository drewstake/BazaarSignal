// Close only a definitively authentication-rejected, still-unclaimed grant.
// One exact-value CAS. Never closes a claimed run, changes counters or retries.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {trialGoogleStore} from '../collector/trial-google';
import {measurementControl} from '../collector/measurement-capacity';
import {type MeasurementState,ledgerHash} from '../collector/measurement';
const input=process.argv[2],read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const rejected=read(input),id=rejected.plan?.id;
if(!/^measure-[a-zA-Z0-9_-]{1,80}$/.test(id)||rejected.action!=='--execute'||!rejected.armed||
  rejected.invocations!==1||![401,403].includes(rejected.invocationStatus)||rejected.measurements?.status!=='armed')throw new Error('Not a definitive unclaimed authentication rejection');
const output=process.argv[3]??`.local/${id}-closed.json`;
if(!/^\.local\/[a-z0-9-]+\.json$/.test(output)||process.argv.length>4)throw new Error('Supply a new private closure receipt path');
const report:any={at:new Date().toISOString(),input,id,attempted:false,counters:{},errors:[]};
writeFileSync(output,JSON.stringify(report),{flag:'wx'});
const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
try {
  const auth=createRequire(resolve('package.json'))('firebase-tools/lib/auth');
  const account=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw new Error('Existing login unavailable');
  const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  const store=trialGoogleStore({project:'bazaarsignal-510305',bucket:'bazaarsignal-510305-market-cache',token:async()=>token,
    onAttempt:c=>{for(const[k,n]of Object.entries(c)){report.counters[k]=(report.counters[k]??0)+n;if(report.counters[k]>(measurementControl[k]??0))throw new Error('Closure accounting bound');}save();}});
  const raw=await store.read('live-allowance');if(!raw)throw new Error('Missing ledger');
  const state:MeasurementState=JSON.parse(raw),run=state.measurementRuns?.[id];
  if(!run||run.status!=='armed'||run.claimedAt!==undefined||JSON.stringify(run.plan)!==JSON.stringify(rejected.plan)||
    state.stoppedAt!==run.priorStop.stoppedAt||state.reason!==run.priorStop.reason)throw new Error('Grant changed or already claimed; no closure');
  report.beforeHash=ledgerHash(state);report.beforeReservations={monthly:state.monthlyReserved,daily:state.dailyReserved};
  run.status='failed';run.finishedAt=Date.now();run.errors=[`Cloud Run authentication rejected HTTP ${rejected.invocationStatus}; no handler claim, no retry. Operator closed the unused grant; every reservation retained.`];
  report.attempted=true;save();
  if(!await store.commit('live-allowance',raw,JSON.stringify(state)))throw new Error('Closure conflict; no retry');
  report.closed=true;
  const after:MeasurementState=JSON.parse((await store.read('live-allowance'))!);
  report.afterHash=ledgerHash(after);report.run=after.measurementRuns?.[id];report.remainingReservations={monthly:after.monthlyReserved,daily:after.dailyReserved};
  report.countersPreserved=JSON.stringify(report.beforeReservations)===JSON.stringify(report.remainingReservations);
  report.stopPreserved=after.stoppedAt===state.stoppedAt&&after.reason===state.reason;
  report.periodPreserved=after.id===state.id&&after.startsAt===state.startsAt&&after.expiresAt===state.expiresAt;
  if(!report.countersPreserved||!report.stopPreserved||!report.periodPreserved||report.run?.status!=='failed')throw new Error('Closure verification changed');
}catch(e){report.errors.push((e as Error).message);report.errorCode=(e as any).code??null;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,closed:report.closed,errors:report.errors},null,2));}
