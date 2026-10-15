import { expect, it, vi } from 'vitest';
import { trialGoogleStore } from '../collector/trial-google';
import { TrialSession } from '../collector/trial';
import { paidEnvelope } from '../collector/paid-budget';
import { offlineGoogle } from './support/offline-google';
import { randomBytes } from 'node:crypto';
import { MarketCollector } from '../collector/engine';
import { SqliteCache } from '../collector/cache-store';
import { defaultPolicy } from '../collector/policy';

const busy = () => Response.json({error:{status:'RESOURCE_EXHAUSTED',message:'This database has exceeded their maximum bandwidth for writes'}},{status:429});

it('retries at most twice, counts every RPC, and has enough reserved inline storage for all attempts', async () => {
  const f = offlineGoogle(), report = vi.fn(); let commits = 0;
  const session = new TrialSession({add:async()=>{},finish:async()=>{}},'test','test',Date.now()+60000,
    paidEnvelope('collector'),Date.now,0,'normal');
  const store = trialGoogleStore({...f.config,inlineSmallSnapshots:true,report,
    network:async (url, init) => String(url).endsWith(':commit') && ++commits < 3 ? busy() : f.config.network!(url,init)},session);
  const control = JSON.stringify({lease:{owner:'fixture',until:Date.now()+60000}});
  f.seed('control',control);
  const payload = JSON.stringify({random:randomBytes(500000).toString('base64')});
  expect(await store.commit('control',control,control,{key:'bazaar',value:payload})).toBe(true);
  expect(commits).toBe(3);
  expect(session.observed).toMatchObject({firestoreReads:3,firestoreWrites:6});
  expect(await store.read('bazaar')).toBe(payload);
  expect(report.mock.calls.map(c=>c[0].event)).toEqual(['firestore_retry','firestore_retry']);
  expect(report.mock.calls.every(c=>c[0].delayMs>=250 && c[0].delayMs<1000)).toBe(true);
});

it('exhausts three attempts and preserves the previous snapshot with a durable failure event', async () => {
  const f=offlineGoogle(), report=vi.fn(); let commits=0;
  f.seed('control',JSON.stringify({lease:{until:Date.now()+60000}})); f.seed('bazaar','last-good');
  const store=trialGoogleStore({...f.config,inlineSmallSnapshots:true,report,network:async(url,init)=>{
    if(String(url).endsWith(':commit')){commits++;return busy();}return f.config.network!(url,init);
  }});
  await expect(store.commit('control',f.read('control')!,f.read('control')!,{key:'bazaar',value:'new'})).rejects.toMatchObject({code:429});
  expect(commits).toBe(3);expect(f.read('bazaar')).toBe('last-good');
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({event:'firestore_operation_failed',attempt:3,code:429,reason:'firestore-write-bandwidth'}));
});

it.each(['changed','expired'])('rereads state and does not publish after the owner is %s during backoff', async mode => {
  let now=Date.now(); const f=offlineGoogle(()=>now); let commits=0;
  const original=JSON.stringify({lease:{until:now+1000}});f.seed('control',original);
  const store=trialGoogleStore({...f.config,inlineSmallSnapshots:true,network:async(url,init)=>{
    if(String(url).endsWith(':commit')){
      commits++; if(mode==='changed')f.seed('control','new-owner');else now+=2000;
      return busy();
    }return f.config.network!(url,init);
  }});
  expect(await store.commit('control',original,original,{key:'bazaar',value:'stale'})).toBe(false);
  expect(commits).toBe(1);expect(f.read('bazaar')).toBeUndefined();
});

it.each([429,503,403])('does not retry quota exhaustion or ambiguous/permanent failures (%s)',async status=>{
  const f=offlineGoogle();let commits=0;
  const store=trialGoogleStore({...f.config,network:async(url,init)=>{
    if(String(url).endsWith(':commit')){commits++;return Response.json({error:{message:status===429?'Daily quota exhausted':'Failed'}},{status});}
    return f.config.network!(url,init);
  }});
  await expect(store.commit('control',null,'value')).rejects.toMatchObject({code:status});expect(commits).toBe(1);
});

it('stops retries before another RPC when the reservation is exhausted',async()=>{
  const f=offlineGoogle();let commits=0;
  const session=new TrialSession({add:async()=>{},finish:async()=>{}},'test','test',Date.now()+60000,
    {...paidEnvelope('collector'),firestoreWrites:1},Date.now,0,'normal');
  const store=trialGoogleStore({...f.config,network:async(url,init)=>{
    if(String(url).endsWith(':commit')){commits++;return busy();}return f.config.network!(url,init);
  }},session);
  await expect(store.commit('control',null,'value')).rejects.toThrow('firestoreWrites');expect(commits).toBe(1);
});

it('cancels backoff at the invocation deadline without sending another write',async()=>{
  const f=offlineGoogle();let commits=0;
  const session=new TrialSession({add:async()=>{},finish:async()=>{}},'test','test',Date.now()+100,
    paidEnvelope('collector'),Date.now,0,'normal');
  const store=trialGoogleStore({...f.config,network:async(url,init)=>{
    if(String(url).endsWith(':commit')){commits++;return busy();}return f.config.network!(url,init);
  }},session);
  await expect(store.commit('control',null,'value')).rejects.toThrow();expect(commits).toBe(1);
});

it('logs collection failures before bookkeeping, and later successful refreshes do not erase those events',async()=>{
  const store=new SqliteCache(':memory:'), report=vi.fn();let now=Date.now(),fail=true;
  const collector=new MarketCollector(store,defaultPolicy,async()=>{
    if(fail)throw Object.assign(Error('private-provider-body'),{code:429});
    return Response.json({success:true,items:[]});
  },()=>now,()=>0,undefined,0,undefined,report);
  try{
    await collector.tick(['catalog']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({event:'collection_failed',job:'catalog',code:429}));
    expect(JSON.stringify(report.mock.calls)).not.toContain('private-provider-body');
    fail=false;now+=3600000;await collector.tick(['catalog']);
    expect((await collector.coordinator.state()).jobs.catalog.failures).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
  }finally{await store.close();}
});
