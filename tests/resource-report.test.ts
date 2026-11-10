import {afterEach, expect, it, vi} from 'vitest';
const {read, commit} = vi.hoisted(()=>({read:vi.fn(),commit:vi.fn()}));
vi.mock('../apps-script/store', async original=>({...await original() as any,readDoc:read,commit}));
import {measureResources, scheduledResourceTick, readResourceReport, refreshResourcesAfterAuthorization} from '../apps-script/resource-report';

const now = Date.parse('2026-11-10T21:00:00Z');
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it('measures November counters, daily operations, and capacity with distinct periods',()=>{
  const urls:string[]=[];
  const result=measureResources(url=>{urls.push(url);return {timeSeries:[{points:[{interval:{endTime:new Date(now-3600000).toISOString()},value:{int64Value:'42'}}]}]};},now,97);
  expect(result.rows).toHaveLength(27);
  expect(result.rows.find(r=>r.id==='run-requests')).toMatchObject({measured:42,periodStart:Date.parse('2026-11-01T07:00:00Z'),periodEnd:Date.parse('2026-12-01T08:00:00Z'),kind:'monthly',percent:null});
  expect(result.rows.find(r=>r.id==='bazaarsignal-read')).toMatchObject({periodStart:Date.parse('2026-11-10T08:00:00Z'),kind:'daily'});
  expect(result.rows.find(r=>r.id==='script-mail')).toMatchObject({measured:3,measuredAt:now});
  expect(result.rows.find(r=>r.id==='script-fetch')?.measured).toBeNull();
  expect(urls.length).toBeLessThanOrEqual(30);
  expect(new URL(urls.find(u=>u.includes('run.googleapis.com%2Frequest_count'))!).searchParams.get('interval.startTime')).toBe('2026-11-01T07:00:00.000Z');
});
it('does not turn failed, partial, or empty provider responses into zero',()=>{
  for(const response of [{error:'Denied',status:403},{nextPageToken:'more'},{}]) {
    const report=measureResources(()=>response,now);
    expect(report.rows.find(r=>r.id==='run-requests')?.measured).toBeNull();
    expect(report.rows.find(r=>r.id==='images')?.measured).toBeNull();
  }
});
it('rolls monthly counters forward without carrying October totals into November',()=>{
  const result=measureResources(()=>({}),Date.parse('2026-12-01T08:30:00Z'));
  expect(result.rows.find(r=>r.id==='run-requests')).toMatchObject({measured:null,measuredAt:null,periodStart:Date.parse('2026-12-01T08:00:00Z')});
});
it('runs once from delayed minute ticks without depending on paid activation and retains failed slots',()=>{
  const values:Record<string,string>={MARKET_OPERATING_MODE:'paused'};
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperty:(k:string)=>values[k]??null,setProperty:(k:string,v:string)=>{values[k]=v;}})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>true,releaseLock:vi.fn()})});
  vi.stubGlobal('ScriptApp',{getOAuthToken:()=> 'private'});
  vi.stubGlobal('MailApp',{getRemainingDailyQuota:()=>100});
  const fetch=vi.fn((url:string,options:any)=>{
    if(url.startsWith('https://monitoring.googleapis.com/')) expect(options.headers['x-goog-user-project']).toBe('bazaarsignal-510305');
    return {getResponseCode:()=>403};
  });
  vi.stubGlobal('UrlFetchApp',{fetch});
  read.mockImplementation((path:string)=>path==='config/access'?{fields:{ownerUid:{stringValue:'owner'}}}:null);
  expect(scheduledResourceTick(now)).toMatchObject({ok:true,generatedAt:now});
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0][0][0].update.name).toContain('/owners/owner/reports/resources');
  const calls=fetch.mock.calls.length;
  expect(scheduledResourceTick(now+60000)).toEqual({ok:true,skipped:true});
  expect(fetch).toHaveBeenCalledTimes(calls);
  const failedSlot=values.RESOURCE_REPORT_ATTEMPT_SLOT;
  expect(refreshResourcesAfterAuthorization(now+60000)).toMatchObject({ok:true,generatedAt:now+60000});
  expect(values.RESOURCE_REPORT_ATTEMPT_SLOT).toBe(failedSlot);
  expect(refreshResourcesAfterAuthorization(now+86400000)).toEqual({ok:true,skipped:true});
  commit.mockImplementation(()=>{throw Error('Write failed');});
  expect(()=>scheduledResourceTick(now+86400000)).toThrow('Write failed');
  expect(scheduledResourceTick(now+86460000)).toEqual({ok:true,skipped:true});
});
it('checks owner identity before reading resource documents',()=>{
  expect(()=>readResourceReport({uid:'other',email:'other@example.com'})).toThrow('owner access required');
  expect(read).not.toHaveBeenCalled();
});
