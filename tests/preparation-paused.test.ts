import { expect,it,vi,afterEach } from 'vitest';
import { scheduledPoll,scheduledMinuteTick,installTrigger,installAlignedTrigger,configureFreeTierMarket,sendTestConfirmation,sendTestTarget } from '../apps-script/backend';
import { PORTFOLIO_COLLECTION_ENABLED,PORTFOLIO_EVALUATION_ENABLED } from '../shared/companion/portfolio-policy';
import { EMAIL_DELIVERY_ENABLED,BACKGROUND_JOBS_ENABLED } from '../shared/automation-policy';
afterEach(()=>vi.unstubAllGlobals());
it('all production automation defaults stay off before properties, storage, triggers or mail',()=>{
  const unexpected=vi.fn(()=>{throw new Error('No service access allowed');});
  vi.stubGlobal('PropertiesService',{getScriptProperties:unexpected});
  vi.stubGlobal('MailApp',{sendEmail:unexpected,getRemainingDailyQuota:unexpected});
  vi.stubGlobal('ScriptApp',{newTrigger:unexpected,getProjectTriggers:unexpected});
  expect([PORTFOLIO_COLLECTION_ENABLED,PORTFOLIO_EVALUATION_ENABLED,EMAIL_DELIVERY_ENABLED,BACKGROUND_JOBS_ENABLED]).toEqual([false,false,false,false]);
  expect(scheduledPoll()).toEqual({ok:true,paused:true});expect(scheduledMinuteTick()).toEqual({ok:true,paused:true});
  for(const fn of [installTrigger,installAlignedTrigger,configureFreeTierMarket,sendTestConfirmation,sendTestTarget])expect(fn).toThrow('paused');
  expect(unexpected).not.toHaveBeenCalled();
});
