import {expect,it} from 'vitest';
import {assertMeasurementPolicy,measurementPolicyTransition,policyTransitionWrites} from '../scripts/measurement-policy-transition';
import {livePolicy} from '../collector/allowance-live';
import {Coordinator} from '../collector/coordinator';
import {SqliteCache} from '../collector/cache-store';
const ledger:any={stoppedAt:1,reason:'Retained owner stop',expiresAt:100000,measurementRuns:{prior:{status:'failed'}}};
function fixture(){return {...new Coordinator(new SqliteCache(':memory:'),livePolicy).empty(),revision:4460,totalRequests:2042,
  requests:[{at:1,retry:false,path:'retained'}],jobs:{bazaar:{nextAt:50000} as any},policy:{...livePolicy,auctionMinMs:3600000}};}
it('changes only retry policy/revision and restores without losing intervening usage',()=>{
 const old=fixture(),next=measurementPolicyTransition(old,ledger,100);
 expect(next).toEqual({...old,revision:4461,policy:{...old.policy,maxRetries:0}});
 expect(old.policy.maxRetries).toBe(2);next.totalRequests+=3;
 const restored=measurementPolicyTransition(next,ledger,101,true);
 expect(restored.totalRequests).toBe(2045);expect(restored.requests).toEqual(old.requests);expect(restored.jobs).toEqual(old.jobs);
 expect(restored.policy).toEqual(old.policy);
});
it('refuses a lease, nonterminal grant, missing stop, expiry or unrelated policy drift',()=>{
 expect(()=>measurementPolicyTransition({...fixture(),lease:{owner:'active',until:1}},ledger,100)).toThrow();
 for(const change of [{stoppedAt:undefined},{expiresAt:99},{measurementRuns:{run:{status:'claimed'}}},{measurementRuns:{run:{status:'armed'}}}])
  expect(()=>measurementPolicyTransition(fixture(),{...ledger,...change},100)).toThrow();
 const drift=fixture();drift.policy.reserve=.1;expect(()=>measurementPolicyTransition(drift,ledger,100)).toThrow('policy');
});
it('fences both documents in the same batch and keeps the ledger byte-identical',()=>{
 const raw=JSON.stringify(ledger),c={name:'control',updateTime:'v1',fields:{value:{stringValue:JSON.stringify(fixture())}}},l={name:'ledger',updateTime:'v2',fields:{value:{stringValue:raw}}};
 const writes=policyTransitionWrites(c,l,measurementPolicyTransition(fixture(),ledger,100));
 expect(writes.map(w=>w.currentDocument)).toEqual([{updateTime:'v1'},{updateTime:'v2'}]);
 expect(writes[1].update.fields.value.stringValue).toBe(raw);
 expect(()=>policyTransitionWrites({...c,updateTime:undefined},l,fixture())).toThrow('versions');
});
it('allows the deployed zero-retry coordinator to use existing control after migration',async()=>{
 const store=new SqliteCache(':memory:'),control=fixture();control.jobs={};control.requests=[];
 await store.commit('control',null,JSON.stringify(control));
 const coordinator=new Coordinator(store,{...livePolicy,maxRetries:0},()=>100);
 expect(()=>assertMeasurementPolicy(control,true)).toThrow('no grant');
 await expect(coordinator.acquire(['bazaar'])).rejects.toThrow('differs');
 const before=(await store.read('control'))!;
 await store.commit('control',before,JSON.stringify(measurementPolicyTransition(control,ledger,100)));
 expect(()=>assertMeasurementPolicy(measurementPolicyTransition(control,ledger,100),true)).not.toThrow();
 expect(await coordinator.acquire(['bazaar'])).toBe(true);
 expect(JSON.parse((await store.read('control'))!).totalRequests).toBe(2042);
 await coordinator.release();await store.close();
});
