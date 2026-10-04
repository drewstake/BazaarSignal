import { capacityMeters, publishedCapacityCeilings, type CapacityPlan } from '../../collector/capacity-plan';
import { liveMaximums,liveDailyMaximums,pacificDay, type LiveAllowanceState } from '../../collector/allowance-live';

/** SYNTHETIC ONLY. No current consumption or activation authorization is asserted.
 * Non-cloud meters with no modeled work get illustrative finite test allowances. */
export function capacityFixture(now:number,days=31):LiveAllowanceState {
  const daily=new Set(['firestoreReads','firestoreWrites','firestoreDeletes','ownerReads','ownerWrites','ownerDeletes','hostingTransferBytes','scriptRuntimeSeconds','scriptFetches','scriptRecipients','scriptProperties']);
  const p:CapacityPlan={version:1,evidence:'OFFLINE synthetic complete evidence, never install',verifiedAt:now,validUntil:now+900000,
    readerGroups:1,browserResponseBytes:64*1024,ingressBoundEvidence:'Synthetic ingress, no real requests',meters:{} as CapacityPlan['meters'],
    upstream:{source:'Synthetic upstream only',verifiedAt:now,scopeComplete:true,requestLimit:120,windowMs:300000,reserve:.2,
      bazaarSourceMs:60000,bazaarDurationMs:1000}};
  for(const [key,unit]of Object.entries(capacityMeters))p.meters[key as keyof typeof capacityMeters]={
    unit,scope:'Offline fixture: complete appropriate account/project/user scope',scopeComplete:true,eligible:true,source:'Offline fixture',
    periodStart:now,periodEnd:now+(daily.has(key)?25*3600000:days*86400000),measuredAt:now,
    allowance:publishedCapacityCeilings[key as keyof typeof capacityMeters],measured:0,reserved:0,fixedRemaining:key==='schedulerJobMonths'?1:key==='artifactByteMonths'?100e6:0,
    uncertainty:0,safetyFraction:.25,...(publishedCapacityCeilings[key as keyof typeof capacityMeters]===0?{exemption:'Offline fixture has no such operations; not production evidence'}:{})};
  return {version:1,id:'free-capacity-fixture',startsAt:now,expiresAt:now+days*86400000,
    monthlyLimits:{...liveMaximums},monthlyReserved:{},dailyLimits:{...liveDailyMaximums},dailyReserved:{},day:pacificDay(now),
    observed:{},evidence:'OFFLINE fixture',capacity:p};
}
