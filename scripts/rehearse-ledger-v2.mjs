// No --apply mode, Google transport, credential lookup or application invocation.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyPacket} from './verify-ledger-v2-packet.mjs';
import {migrationFixture} from './ledger-v2-fixture.mjs';
import {accountingHash} from './ledger-v2-migration.mjs';

export async function rehearse(packetPath,outputDirectory) {
  const verified=verifyPacket(packetPath),out=resolve(outputDirectory);
  if(existsSync(out))throw Error('Rehearsal output already exists; refusing overwrite');
  mkdirSync(out,{recursive:true});const results=[];
  const save=(name,data)=>writeFileSync(join(out,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
  for(const scenario of ['rollout-no-mail','rollback-before-v2','rollback-after-v2','api-deployment-rejected','lost-reservation-response','lost-deployment-response']) {
    const f=migrationFixture(verified.packet.artifacts),c=f.coordinator;
    await c.start();await c.contain();
    if(scenario==='api-deployment-rejected')f.hooks.beforeApply=a=>{if(a.kind==='deploy'&&a.name==='marketapi')throw Object.assign(Error('Synthetic API deployment rejection'),{code:'REJECTED'});};
    if(scenario.startsWith('lost-')) {
      const target=scenario==='lost-reservation-response'?'reserve':'deploy';let once=true;
      f.hooks.afterApply=a=>{if(once&&a.kind===target){once=false;throw Error('Synthetic lost acknowledgement');}};
    }
    let expectedFailure;
    try {await c.deploy();} catch(e) {
      if(scenario!=='api-deployment-rejected')throw e;
      expectedFailure=e.message;f.hooks.beforeApply=undefined;await c.rollback();
    }
    if(scenario==='rollback-before-v2')await c.rollback('original');
    if(['rollout-no-mail','rollback-after-v2'].includes(scenario)) {
      await c.beginNaturalVerification({collection:true});await c.acceptNaturalEvidence(f.naturalEvidence());
      if(scenario==='rollout-no-mail')await c.reopen({api:true,daily:true,mail:false});
      else {
        const before=accountingHash(f.state);
        try {await c.rollback('original');throw Error('Unsafe rollback unexpectedly passed');}
        catch(e){if(!e.message.includes('v1-only'))throw e;expectedFailure=e.message;}
        await c.rollback();if(accountingHash(f.state)!==before)throw Error('Rollback changed accounting');
      }
    }
    const result={scenario,passed:true,expectedFailure,phase:c.journal.phase,
      ledgerVersion:f.state.ledger.value.version,admissionCount:f.state.ledger.value.admissionCount??Object.keys(f.state.ledger.value.admissions).length,
      retainedReservationUsd:f.state.ledger.value.reservedUsd,workerPaused:f.state.worker.paused,
      mutations:f.records.length,coordinatorCalls:c.calls,compiledManagementRequests:f.requests.filter(r=>r.url).length,
      realNetworkCalls:0,realCollectorInvocations:0,emailsSent:0};
    save(`${scenario}.json`,{result,journal:c.journal,reviewableRequests:f.requests});results.push(result);
  }
  const report={kind:'isolated-rehearsal',at:new Date().toISOString(),packetSha256:verified.packetSha256,
    productionExecutionEnabled:false,syntheticEvidence:true,artifacts:verified.packet.artifacts,results};
  save('summary.json',report);return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [mode,packetPath,out]=process.argv.slice(2);
  if(mode!=='--rehearse'||!packetPath||!out||process.argv.length!==5)
    throw Error('Production execution is disabled. Usage: node scripts/rehearse-ledger-v2.mjs --rehearse <packet.json> <new-local-output-directory>');
  const root=resolve(dirname(import.meta.filename),'..');
  if(!resolve(out).startsWith(join(root,'.local')+'/')&&!resolve(out).startsWith(join(root,'.local')+'\\'))throw Error('Use a private .local output directory');
  const report=await rehearse(packetPath,out);
  console.log(JSON.stringify({file:join(resolve(out),'summary.json'),scenarios:report.results.length,passed:report.results.every(r=>r.passed),productionExecutionEnabled:false},null,2));
}
