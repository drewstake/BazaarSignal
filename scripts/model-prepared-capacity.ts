/** Offline only. No credentials, fetches, service activation or cloud mutations. */
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { gunzipSync,gzipSync } from 'node:zlib';
import { capacityFixture } from '../tests/support/capacity-fixture';
import { chooseCadence } from '../collector/capacity-plan';
import { liveInvocationCharge,nextPacificReset } from '../collector/allowance-live';
import { SqliteCache } from '../collector/cache-store';
import { MarketCollector } from '../collector/engine';

const now=Date.parse('2026-10-04T12:00:00Z');
const ledger=JSON.parse(JSON.parse(readFileSync('.local/paused-cadence-inspect.json','utf8')).ledger.fields.value.stringValue);
const measured=JSON.parse(readFileSync('.local/usage-dashboard-measured.json','utf8'));
const sample=JSON.parse(gunzipSync(readFileSync('.local/zero-cost-backup/bazaar.json.gz')).toString());
const store=new SqliteCache(':memory:');
await store.commit('bazaar',null,JSON.stringify(sample));
const collector=new MarketCollector(store,undefined,async()=>{throw new Error('Offline model may not access upstream');},()=>now);
const assets=['bz_BOOSTER_COOKIE','bz_ENCHANTED_DIAMOND_BLOCK','bz_ENCHANTED_GOLD_BLOCK'];
const start=performance.now(),cpu=process.cpuUsage();
const selected=await collector.portfolioPrices(assets);
const elapsedMs=performance.now()-start,processCpu=process.cpuUsage(cpu);
const full=await collector.bazaar();
await store.close();
const bytes=(data:unknown)=>({json:Buffer.byteLength(JSON.stringify(data)),gzip:gzipSync(JSON.stringify(data)).length});
const periods=[28,29,30,31].map(days=>{
  const s=capacityFixture(now,days);
  // This is a deliberately synthetic, complete-scope proof fixture. It includes
  // the preserved application reservations from the last saved real ledger.
  s.monthlyReserved={...ledger.monthlyReserved};s.dailyReserved={...ledger.dailyReserved};
  const d=chooseCadence(s.capacity,{...s,dailyEnd:nextPacificReset(now)},liveInvocationCharge('collector'),liveInvocationCharge('browser'),now);
  return {days,scenario:'Synthetic verified scope; actual app reservations retained; not an operating grant',...d};
});
const report={version:1,createdAt:new Date().toISOString(),disabledByDefault:true,
  currentDecision:chooseCadence(undefined,{...ledger,dailyEnd:nextPacificReset(now)},liveInvocationCharge('collector'),liveInvocationCharge('browser'),now),
  savedMeasurementAt:new Date(measured.generatedAt).toISOString(),
  measured:measured.rows.map((r:any)=>({id:r.id,value:r.measured,unit:r.unit,at:r.measuredAt,scope:r.scope,reserved:r.reservation??null,headroom:null})),
  missingEvidence:['Complete current and former billing-account membership and consumption','Destination-specific transfer and byte-month integrals',
    'Hosting daily/monthly entitlement reconciliation','Apps Script account-wide usage and deployed trigger/mail state','Anonymous upstream entitlement and current source frequency',
    'Bounded ingress, rejected admission overhead and evidence-renewal mechanism','Current measurements for every independent scope'],
  responseReplay:{sourceAt:new Date(sample.upstreamAt).toISOString(),items:sample.data.items.length,selectedItems:selected.bazaar.length,
    full:bytes(full),selected:bytes(selected),elapsedMs,processCpuMs:(processCpu.user+processCpu.system)/1000,
    note:'One local SQLite replay; not Cloud Run billed compute. Exact books, variant semantics and timestamps unchanged.'},
  targetScenarios:[60,90,300,3600,5400,7200].map(seconds=>{
    const runs=Math.ceil(31*86400/seconds),browser=runs*4;
    return {seconds,days:31,runs,browserIncludingPresenceAndPreflights:browser,
      minimumBazaarUploads:runs,protectedClassA:runs*4+31*4,
      protectedCpuSeconds:runs*100+browser*20,protectedReadsPer25HourDay:Math.ceil(25*3600/seconds)*(700+4*108),
      remainingPeriodCpuWithExistingReservation:runs*100+browser*20+(ledger.monthlyReserved.cpuSeconds??0)};
  }),periods};
mkdirSync('.local',{recursive:true});
writeFileSync('.local/free-tier-preparation-model.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({current:report.currentDecision.mode,responseReplay:report.responseReplay,
  targetScenarios:report.targetScenarios,conditionalPeriods:periods.map(p=>({days:p.days,mode:p.mode,interval:p.bazaarMs})),
  report:'.local/free-tier-preparation-model.json'},null,2));
