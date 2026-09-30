import { describe,it,expect,vi,beforeEach } from 'vitest';
import { createAlert,deliver,disableAlert,emptyState,parseMarket,poll,publicState } from '../apps-script/core';
import type { DeliveryIO,State } from '../apps-script/core';
import { verifyIdentity } from '../apps-script/backend';
const now=1_790_000_000_000;
const input={requestId:'12345678-1234-4234-8234-123456789012',itemId:'SUMMONING_EYE',side:'buy' as const,quantity:3,target:110,taxRate:1.25};
const raw=(time=now)=>({success:true,lastUpdated:time,products:{SUMMONING_EYE:{buy_summary:[{amount:2,pricePerUnit:100,orders:1},{amount:5,pricePerUnit:130,orders:1}],sell_summary:[{amount:2,pricePerUnit:100,orders:1},{amount:5,pricePerUnit:70,orders:1}]}}});
const market=()=>parseMarket(raw(),now);
function fixture(){const state=emptyState('owner');createAlert(state,input,market(),'owner@example.com','a'.repeat(64),now);return state;}
function ioFor(state:State, overrides:Partial<DeliveryIO>={}) {
  const receipts=new Map<string,number>();let persisted=structuredClone(state);
  const io:DeliveryIO={now:()=>now,quota:()=>100,save:vi.fn(()=>{persisted=structuredClone(state)}),send:vi.fn(),
    receipt:id=>receipts.get(id)||null,remember:(id,at)=>{receipts.set(id,at)},budgetExpired:()=>false,...overrides};
  return {io,receipts,persisted:()=>persisted};
}
describe('Apps Script state and prices',()=>{
  it('uses full asks for buy, full bids less tax for sell, including equality',()=>{
    const state=fixture();state.mail[0].status='sent';poll(state,market(),now);
    expect(state.mail[1].quote?.unit).toBe(110);
    const sell=emptyState('owner');createAlert(sell,{...input,side:'sell',target:88.875},market(),'owner','hash',now);
    sell.mail[0].status='sent';poll(sell,market(),now);expect(sell.mail[1].quote?.unit).toBe(88.875);
  });
  it('rejects the other side of price boundaries and insufficient total liquidity',()=>{
    for(const changes of [{target:109.999},{quantity:8},{side:'sell' as const,target:88.876}]){
      const state=emptyState('owner');createAlert(state,{...input,...changes},market(),'owner','hash',now);
      state.mail[0].status='sent';poll(state,market(),now);expect(state.mail).toHaveLength(1);
    }
  });
  it('rejects stale, future, malformed snapshots and malformed products',()=>{
    expect(()=>parseMarket(raw(now-180001),now)).toThrow();
    expect(()=>parseMarket(raw(now+30001),now)).toThrow();
    expect(parseMarket(raw(now-180000),now).prices).toHaveLength(1);
    for(const value of [NaN,0,-1,'100']) {const m=raw();(m.products.SUMMONING_EYE.buy_summary[0] as any).pricePerUnit=value;expect(()=>parseMarket(m,now)).toThrow();}
    for(const bad of [null,{}, {success:false}, {...raw(),products:[]}]) expect(()=>parseMarket(bad,now)).toThrow();
  });
  it('deduplicates creates; conflicting reuse fails; successful polls are one-shot',()=>{
    const state=fixture();createAlert(state,input,market(),'attacker','anotherhash',now);
    expect(state.alerts).toHaveLength(1);expect(state.mail).toHaveLength(1);expect(state.alerts[0].recipient).toBe('owner@example.com');
    expect(()=>createAlert(state,{...input,target:999},market(),'owner','hash',now)).toThrow(/Request ID/);
    state.mail[0].status='sent';poll(state,market(),now);poll(state,market(),now);expect(state.mail).toHaveLength(2);
  });
  it('limits active alerts to 20 and rejects invalid inputs',()=>{
    const state=emptyState('owner');for(let i=0;i<20;i++)createAlert(state,{...input,requestId:`12345678-1234-4234-8234-${String(i).padStart(12,'0')}`},market(),'owner','hash',now);
    expect(()=>createAlert(state,input,market(),'owner','hash',now)).toThrow(/20 active/);
    for(const bad of [{quantity:1.5},{quantity:0},{target:Infinity},{taxRate:100},{side:'oops'},{itemId:'../x'},{requestId:'x'}])expect(()=>createAlert(emptyState('owner'),{...input,...bad} as any,market(),'owner','hash',now)).toThrow();
  });
  it('waits for confirmation before evaluating a target',()=>{
    const state=fixture();poll(state,market(),now);expect(state.mail).toHaveLength(1);
    state.mail[0].status='failed';poll(state,market(),now);expect(state.mail).toHaveLength(1);
  });
  it('disabling is idempotent, scoped to one hash, and cancels pending mail',()=>{
    const state=fixture();expect(()=>disableAlert(state,'bad',now)).toThrow();expect(state.alerts[0].workflow.paused).toBe(false);
    disableAlert(state,'a'.repeat(64),now);disableAlert(state,'a'.repeat(64),now);
    expect(state.alerts[0].workflow.paused).toBe(true);expect(state.mail[0].status).toBe('cancelled');
  });
  it('never exposes recipients, hashes or links in the owner projection',()=>{
    const projection=JSON.stringify(publicState(fixture()));expect(projection).not.toContain('owner@example.com');expect(projection).not.toContain('aaaaaa');expect(projection).not.toContain('#disable');
  });
});
describe('MailApp queue',()=>{
  it('persists sending before delivery and never intentionally resends success',()=>{
    const state=fixture(),f=ioFor(state);f.io.send=vi.fn(()=>expect(f.persisted().mail[0].status).toBe('sending'));
    deliver(state,f.io);deliver(state,f.io);expect(f.io.send).toHaveBeenCalledTimes(1);expect(state.mail[0].status).toBe('sent');
  });
  it('counts confirmations and target messages against the same quota',()=>{
    const state=fixture(),f=ioFor(state,{quota:()=>1});deliver(state,f.io);poll(state,market(),now);
    f.io.quota=()=>0;deliver(state,f.io);expect(f.io.send).toHaveBeenCalledTimes(1);expect(state.mail[1].status).toBe('queued');expect(state.mail[1].attempts).toBe(0);
  });
  it('defers quota exhaustion, then resumes after quota and delay recover',()=>{
    const state=fixture(),f=ioFor(state,{quota:()=>0});deliver(state,f.io);expect(f.io.send).not.toHaveBeenCalled();expect(state.mail[0].attempts).toBe(0);
    f.io.quota=()=>100;f.io.now=()=>now+3600001;deliver(state,f.io);expect(state.mail[0].status).toBe('sent');
  });
  it('retries failures with bounded backoff and a five-attempt terminal state',()=>{
    const state=fixture();let time=now;const f=ioFor(state,{now:()=>time,send:vi.fn(()=>{throw new Error('network')})});
    for(let i=1;i<=5;i++){deliver(state,f.io);expect(state.mail[0].attempts).toBe(i);time=state.mail[0].nextAttempt;}
    expect(state.mail[0].status).toBe('failed');deliver(state,f.io);expect(f.io.send).toHaveBeenCalledTimes(5);
  });
  it('recovers an independent sent receipt after a Firestore failure',()=>{
    const state=fixture(),f=ioFor(state);const save=f.io.save;let n=0;
    f.io.save=()=>{if(++n===2)throw new Error('storage');save();};expect(()=>deliver(state,f.io)).toThrow();
    const recovered=f.persisted();expect(recovered.mail[0].status).toBe('sending');
    f.io.save=vi.fn();deliver(recovered,f.io);expect(recovered.mail[0].status).toBe('sent');expect(f.io.send).toHaveBeenCalledTimes(1);
  });
  it('does not send if claiming the delivery cannot be persisted',()=>{
    const state=fixture(),f=ioFor(state,{save:()=>{throw new Error('storage')}});expect(()=>deliver(state,f.io)).toThrow();expect(f.io.send).not.toHaveBeenCalled();
  });
  it('waits out interrupted sends and bounds ambiguous retries',()=>{
    const state=fixture(),f=ioFor(state);state.mail[0].status='sending';state.mail[0].attempts=1;state.mail[0].leaseUntil=now+600000;
    deliver(state,f.io);expect(f.io.send).not.toHaveBeenCalled();f.io.now=()=>now+600001;deliver(state,f.io);
    expect(state.mail[0].status).toBe('queued');expect(state.mail[0].nextAttempt).toBe(now+660001);
  });
});
describe('Firebase owner verification',()=>{
  const owner={uid:'owner',email:'drew@theinnovativeowl.com'};
  let user:any,claims:any;
  const token=()=>`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  beforeEach(()=>{
    user={localId:'owner',email:owner.email,emailVerified:true,validSince:'1',providerUserInfo:[{providerId:'google.com'}]};
    claims={sub:'owner',aud:'bazaarsignal',iss:'https://securetoken.google.com/bazaarsignal',email:owner.email,email_verified:true,exp:now/1000+3600,iat:now/1000,auth_time:now/1000,firebase:{sign_in_provider:'google.com'}};
    vi.stubGlobal('UrlFetchApp',{fetch:vi.fn(()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({users:[user]})}))});
    vi.stubGlobal('Utilities',{base64DecodeWebSafe:(s:string)=>Buffer.from(s,'base64url'),newBlob:(b:Buffer)=>({getDataAsString:()=>b.toString()})});
  });
  it('accepts a Firebase-validated, verified Google user',()=>{expect(verifyIdentity(token(),'key',now)).toEqual(owner);});
  it('rejects forged tokens even with correct decoded claims',()=>{
    (globalThis as any).UrlFetchApp.fetch=()=>({getResponseCode:()=>400});expect(()=>verifyIdentity(token(),'key',now)).toThrow();
  });
  it('rejects mismatched identities, wrong projects, stale/revoked identity and disabled accounts',()=>{
    const cases=[()=>user.localId='attacker',()=>user.emailVerified=false,()=>user.disabled=true,()=>claims.aud='another-project',()=>claims.iss='evil',()=>claims.exp=now/1000,()=>user.validSince=String(now/1000+1),()=>claims.firebase.sign_in_provider='password',()=>claims.email='attacker@example.com'];
    const originalUser=structuredClone(user),originalClaims=structuredClone(claims);
    for(const mutate of cases){user=structuredClone(originalUser);claims=structuredClone(originalClaims);mutate();expect(()=>verifyIdentity(token(),'key',now)).toThrow();}
  });
});

