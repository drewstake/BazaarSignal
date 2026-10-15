import {afterEach,expect,it,vi} from 'vitest';
const {run,save,control}=vi.hoisted(()=>({run:vi.fn(()=>({processed:1})),save:vi.fn(),control:{state:{runtimeWindow:0,runtimeMs:0,monitor:{} as any}}}));
vi.mock('../apps-script/portfolio-backend',()=>({runPortfolioNotifications:run,portfolioNotificationRequest:vi.fn()}));
vi.mock('../apps-script/store',async original=>({...await original() as any,loadControl:()=>control,saveControl:save}));
import {scheduledPaidMinuteTick} from '../apps-script/backend';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
it('does no property, database or mail work outside the hourly window',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T21:07:00Z'));
  const unexpected=vi.fn(()=>{throw Error('unexpected');});vi.stubGlobal('PropertiesService',{getScriptProperties:unexpected});
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});expect(unexpected).not.toHaveBeenCalled();
});
it('requires paid activation, retains runtime guard, and admits notification evaluation once per hour',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T21:02:00Z'));
  const p:Record<string,string>={MARKET_OPERATING_MODE:'paid-budget',MARKET_UPDATES_PAUSED:'false',FIREBASE_API_KEY:'public-key',TOKEN_KEY:'a'.repeat(64),APP_URL:'https://bazaarsignal.web.app'};
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperty:(k:string)=>p[k]??null,getProperties:()=>p,setProperty:(k:string,v:string)=>{p[k]=v;}})});
  vi.stubGlobal('Session',{getEffectiveUser:()=>({getEmail:()=> 'bazaarsignal@gmail.com'})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})});
  vi.stubGlobal('MailApp',{getRemainingDailyQuota:()=>98});
  control.state.runtimeWindow=Date.now();control.state.runtimeMs=70*60000;
  expect(scheduledPaidMinuteTick()).toEqual({ok:false,paused:true});expect(run).not.toHaveBeenCalled();
  control.state.runtimeMs=100;
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,processed:1});expect(run).toHaveBeenCalledWith(Date.now(),true);
  expect(scheduledPaidMinuteTick()).toEqual({ok:true,skipped:true});expect(run).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-01T07:02:00Z'));expect(scheduledPaidMinuteTick()).toEqual({ok:true,paused:true});
});
