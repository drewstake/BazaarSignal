import {afterEach,expect,it,vi} from 'vitest';
const {run,save,control}=vi.hoisted(()=>({run:vi.fn<() => {processed:number;failed:number;complete:boolean;paused?:boolean}>(()=>({processed:1,failed:0,complete:true})),save:vi.fn(),control:{state:{runtimeWindow:0,runtimeMs:0,monitor:{} as any} as any}}));
vi.mock('../apps-script/portfolio-backend',()=>({runPortfolioNotifications:run,portfolioNotificationRequest:vi.fn()}));
vi.mock('../apps-script/store',async original=>({...await original() as any,loadControl:()=>control,saveControl:save}));
import {scheduledPaidMinuteTick} from '../apps-script/backend';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
it('does no property, database or mail work outside the quarter-hour window',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T21:07:00Z'));
  const unexpected=vi.fn(()=>{throw Error('unexpected');});vi.stubGlobal('PropertiesService',{getScriptProperties:unexpected});
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});expect(unexpected).not.toHaveBeenCalled();
});
it('retains activation/runtime guards and deduplicates all four notification windows including hourly migration',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T21:02:00Z'));
  const p:Record<string,string>={MARKET_OPERATING_MODE:'paid-budget',MARKET_UPDATES_PAUSED:'false',FIREBASE_API_KEY:'public-key',TOKEN_KEY:'a'.repeat(64),APP_URL:'https://bazaarsignal.web.app'};
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperty:(k:string)=>p[k]??null,getProperties:()=>p,setProperty:(k:string,v:string)=>{p[k]=v;}})});
  vi.stubGlobal('Session',{getEffectiveUser:()=>({getEmail:()=> 'bazaarsignal@gmail.com'})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})});
  vi.stubGlobal('MailApp',{getRemainingDailyQuota:()=>98});
  control.state.runtimeWindow=Date.now();control.state.runtimeMs=70*60000;
  expect(scheduledPaidMinuteTick()).toEqual({ok:false,paused:true});expect(run).not.toHaveBeenCalled();
  control.state.runtimeMs=100;
  p.PAID_LAST_MAIL_SLOT=String(Math.floor(Date.now()/3_600_000));
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});expect(run).not.toHaveBeenCalled();
  delete p.PAID_LAST_MAIL_SLOT;
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,processed:1,failed:0,complete:true});expect(run).toHaveBeenCalledWith(Date.now(),true);
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});expect(run).toHaveBeenCalledTimes(1);
  for(const minute of [17,32,47]) {
    vi.setSystemTime(new Date(`2026-10-13T21:${minute}:00Z`));
    expect(scheduledPaidMinuteTick()).toEqual({ok:true,processed:1,failed:0,complete:true});
    expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});
  }
  expect(run).toHaveBeenCalledTimes(4);
  vi.setSystemTime(new Date('2026-11-01T07:02:00Z'));expect(scheduledPaidMinuteTick()).toEqual({ok:true,paused:true});
});
it.each([
  {processed:0,failed:1,complete:true,error:'failed'},
  {processed:1,failed:0,complete:false,error:'work limit'},
  {processed:0,failed:0,complete:false,paused:true,error:'unavailable'},
])('keeps last successful evaluation unchanged after an incomplete pass: $error', result => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T21:02:00Z'));
  const p:Record<string,string> = {MARKET_OPERATING_MODE:'paid-budget',MARKET_UPDATES_PAUSED:'false',FIREBASE_API_KEY:'public-key',TOKEN_KEY:'a'.repeat(64),APP_URL:'https://bazaarsignal.web.app'};
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperty:(k:string)=>p[k]??null,getProperties:()=>p,setProperty:(k:string,v:string)=>{p[k]=v;}})});
  vi.stubGlobal('Session',{getEffectiveUser:()=>({getEmail:()=> 'bazaarsignal@gmail.com'})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})});
  vi.stubGlobal('MailApp',{getRemainingDailyQuota:()=>98});
  control.state.runtimeWindow=Date.now(); control.state.runtimeMs=0; control.state.paidLastSuccess=Date.now()-900000;
  const previous=control.state.paidLastSuccess;
  const {error,...pass}=result; run.mockReturnValueOnce(pass);
  scheduledPaidMinuteTick();
  expect(control.state.paidLastSuccess).toBe(previous);
  expect(control.state.paidError).toContain(error);
  expect(control.state).toMatchObject({paidLastProcessed:result.processed,paidLastFailed:result.failed,paidLastComplete:result.complete});
});
