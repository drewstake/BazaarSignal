import { readDoc, jsonWrite, commit } from './store';
import { authorizeAdmin, adminClockSlot, nextAdminRefresh } from '../shared/admin';
import { parseUsageReport } from '../shared/published-usage';
import { periods, usageSpecs, summarizeSeries, missingMeasurement, buildMeasurement, repositoryStorageMeasurement } from '../shared/usage-measurements';
import type { UsageDashboard, UsageRow } from '../shared/usage-dashboard';

declare const PropertiesService: any, LockService: any, UrlFetchApp: any, ScriptApp: any, MailApp: any;
const SLOT = 'RESOURCE_REPORT_ATTEMPT_SLOT';
const cloud = 'bazaarsignal-510305';
const query = (values: Record<string, string>) => Object.entries(values)
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

/** One bounded page per source. Missing samples and incomplete inventories are
 * unavailable, never zero. Calendar counters are rebuilt for the current period. */
export function measureResources(get: (url: string) => any, now = Date.now(), mailRemaining?: number): UsageDashboard {
  const period = periods(now), counterEnd = Math.floor(now / 3600000) * 3600000;
  const safe = (url: string) => { try { return get(url); } catch { return { error: 'Source unavailable' }; } };
  const jobs = safe(`https://cloudscheduler.googleapis.com/v1/projects/${cloud}/locations/us-central1/jobs?pageSize=100`);
  const builds = ['us-central1', 'global'].map(region => safe(
    `https://cloudbuild.googleapis.com/v1/projects/${cloud}/locations/${region}/builds?${query({pageSize:'100',filter:`create_time>="${new Date(period.month[0] - 86400000).toISOString()}"`})}`));
  const rows = usageSpecs().map((spec): UsageRow => {
    const [start, end] = spec.daily ? period.day : period.month;
    let m: ReturnType<typeof summarizeSeries> = {value:null,at:null,state:'unavailable',coverage:'not-exposed',coverageDetail:'Google does not expose total account consumption for this quota.'};
    if (spec.metric) {
      const q: Record<string, string> = {
        filter: `metric.type="${spec.metric}" AND resource.labels.project_id="${spec.project}"${spec.filter ? ` AND ${spec.filter}` : ''}`,
        view: 'FULL', 'interval.startTime': new Date(spec.gauge ? now - 3 * 86400000 : start).toISOString(),
        'interval.endTime': new Date(spec.gauge ? now : counterEnd).toISOString(), pageSize: spec.gauge ? '10000' : '1000',
      };
      if (!spec.gauge) Object.assign(q, {'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':'ALIGN_SUM','aggregation.crossSeriesReducer':'REDUCE_SUM'});
      m = counterEnd <= start && !spec.gauge ? missingMeasurement({}) : summarizeSeries(safe(`https://monitoring.googleapis.com/v3/projects/${spec.project}/timeSeries?${query(q)}`), !!spec.gauge, spec.divisor);
    } else if (spec.id === 'scheduler') {
      m = jobs.error || jobs.nextPageToken ? missingMeasurement(jobs) : {value:(jobs.jobs ?? []).length,at:now,state:'measured'};
    } else if (spec.id === 'builds') m = buildMeasurement(builds, start, now, now);
    else if (spec.id === 'images') m = repositoryStorageMeasurement(safe(`https://artifactregistry.googleapis.com/v1/projects/${cloud}/locations/us-central1/repositories/gcf-artifacts`), now);
    else if (spec.id === 'script-mail' && Number.isInteger(mailRemaining) && mailRemaining! >= 0 && mailRemaining! <= 100) m = {value:100-mailRemaining!,at:now,state:'measured'};
    return {
      id:spec.id,project:spec.project,resource:spec.resource,purpose:spec.purpose,unit:spec.unit,
      measured:m.value,measuredAt:m.at,state:m.state,coverage:m.coverage,coverageDetail:m.coverageDetail,
      allowance:null,allowanceLabel:'Usage measurement; not a spending allowance',scope:`Project ${spec.project}`,
      periodStart:start,periodEnd:end,periodLabel:spec.gauge?'Latest capacity':spec.id.startsWith('script-')?'Rolling 24 hours':spec.daily?'Today (Pacific)':'Month to date (Pacific)',
      kind:spec.gauge?'capacity':spec.id.startsWith('script-')?'rolling':spec.daily?'daily':'monthly',
      percent:null,remaining:null,projected:null,reservation:null,budget:null,reservationPeriod:'Not applicable',
      source:spec.metric ?? spec.resource,sourceUrl:spec.url ?? 'https://console.cloud.google.com/monitoring',note:'Provider data may arrive late. Usage does not establish charges.',
      ...(spec.id==='images'?{measurementBasis:'artifact-registry-sizeBytes' as const}:{}),
    };
  });
  const scheduler = jobs.error || jobs.nextPageToken ? 'Unavailable' : (jobs.jobs ?? []).find((j:any) => j.name?.endsWith('/firebase-schedule-refreshMarket-us-central1'))?.state ?? 'Unavailable';
  return {
    generatedAt:now,nextMeasurementAt:nextAdminRefresh(now),rows,
    spending:{state:'unavailable',month:null,total:null,coverage:'Resource usage only',reason:'Usage counters are not a billing statement.',setup:'View actual charges in Google Billing.',sourceUrl:'https://console.cloud.google.com/billing',checkedAt:new Date(now).toISOString()},
    collection:{state:scheduler,reason:'Observed scheduler configuration; this does not establish successful collection.',pressure:null,reviewAt:null,lastSuccessAt:null,nextCollectionAt:null,scheduler,cleanup:'Unchanged',measuredAt:now},
  };
}

function path() {
  const owner = readDoc('config/access')?.fields?.ownerUid?.stringValue;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner ?? '')) throw Error('Resource report owner unavailable.');
  return `owners/${owner}/reports/resources`;
}
export function readResourceReport(identity: {uid:string;email:string}) {
  authorizeAdmin(identity);
  const saved = readDoc(path());
  if (!saved) throw Error('Current resource report has not been published yet. The reporting clock will collect it automatically.');
  return {...parseUsageReport(saved.fields?.json?.stringValue),publishedReport:true};
}

/** Runs from the existing minute clock, independently of collection mode or
 * pilot expiry. Claim before I/O, including failures; at most one attempt/day.
 * Catch up on delayed triggers without depending on a single exact minute. */
export function scheduledResourceTick(now = Date.now()) {
  return collectResourceReport(now, SLOT, String(adminClockSlot(now)));
}
/** Explicit one-time repair after OAuth authorization. Keeps the failed daily
 * attempt intact and cannot become an unbounded manual refresh endpoint. */
export function refreshResourcesAfterAuthorization(now = Date.now()) {
  return collectResourceReport(now, 'RESOURCE_REPORT_AUTHORIZATION_REPAIR_V2', '1');
}
function collectResourceReport(now: number, attemptProperty: string, slot: string) {
  const properties = PropertiesService.getScriptProperties();
  if (Number(properties.getProperty(attemptProperty) ?? -Infinity) >= Number(slot)) return {ok:true,skipped:true};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) return {ok:true,skipped:true};
  let reportPath: string, version: string | null;
  try {
    if (Number(properties.getProperty(attemptProperty) ?? -Infinity) >= Number(slot)) return {ok:true,skipped:true};
    properties.setProperty(attemptProperty,slot);
    reportPath = path();
    version = readDoc(reportPath)?.updateTime ?? null;
  } finally { lock.releaseLock(); }
  const token = ScriptApp.getOAuthToken();
  let calls = 0;
  const report = measureResources(url => {
    if (++calls > 30) throw Error('Resource request bound exceeded.');
    const project = url.match(/\/projects\/(bazaarsignal(?:-510305)?)(?:\/|\?)/)?.[1];
    if (!project) throw Error('Unexpected reporting project.');
    // Monitoring requires a billing-enabled quota project even for the Spark
    // project's metrics. Reuse the existing market project; do not enable billing.
    const quotaProject = url.startsWith('https://monitoring.googleapis.com/') ? cloud : project;
    const response = UrlFetchApp.fetch(url,{headers:{Authorization:`Bearer ${token}`,'x-goog-user-project':quotaProject},muteHttpExceptions:true,followRedirects:false});
    if (response.getResponseCode() !== 200) {
      let reason: string | undefined;
      try { reason = JSON.parse(response.getContentText()).error?.details?.find((d:any)=>d.reason)?.reason; } catch {}
      return {error:'Source unavailable',status:response.getResponseCode(),reason};
    }
    const text = response.getContentText();
    if (text.length > 2000000) throw Error('Resource response exceeded limit.');
    return JSON.parse(text);
  }, now, MailApp.getRemainingDailyQuota());
  commit([jsonWrite(reportPath, report, version)]);
  return {ok:true,generatedAt:now,measured:report.rows.filter(row=>row.measured!==null).length};
}
