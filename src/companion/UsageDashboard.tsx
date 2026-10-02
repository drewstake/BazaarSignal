import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../data';
import type { UsageDashboard as Dashboard, UsageRow } from '../../shared/usage-dashboard';
import { verifiedUsageSnapshot } from '../../shared/usage-dashboard';
import { currentStatus, imageStorageEstimate, kindOf, needsAttention, projectionStatus, sortResources } from '../../shared/usage-presentation';
import './usage-dashboard.css';
import { ownerCandidate } from './usage-access';

function amount(value:number|null,unit:string) {
  if(value===null || !Number.isFinite(value))return 'Unknown';
  if(unit==='bytes') {
    const scale=value>=1024**3?1024**3:value>=1024**2?1024**2:value>=1024?1024:1;
    return `${(value/scale).toLocaleString(undefined,{maximumFractionDigits:2})} ${scale===1024**3?'GiB':scale===1024**2?'MiB':scale===1024?'KiB':'bytes'}`;
  }
  return `${value.toLocaleString(undefined,{maximumFractionDigits:1})} ${unit}`;
}
const date=(value:number|null)=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unknown';
const tone=(status:string)=>status==='Over allowance'?'over':status==='Getting close'?'close':status==='Within allowance'?'within':'unknown';
const windowLabel=(row:UsageRow)=>row.id==='scheduler'?'Configured jobs':({daily:'Today',monthly:'This month',capacity:'Stored capacity',rolling:'Current 24-hour quota'})[kindOf(row)];
const coverageLabels={permission:'Missing permission',delay:'No reported samples',setup:'Missing setup','not-exposed':'No Google quota API',incomplete:'Incomplete coverage',error:'Source unavailable'};
const expiredRow=(row:UsageRow,now:number)=>['daily','monthly'].includes(kindOf(row))&&now>=row.periodEnd;

function ResourceCard({row,stale,now}:{row:UsageRow;stale:boolean;now:number}) {
  const expired=stale||expiredRow(row,now);
  const status=currentStatus(row,expired),attention=needsAttention(row,expired),kind=kindOf(row);
  const percent=row.measured!==null&&row.allowance?row.measured/row.allowance*100:null;
  const estimate=imageStorageEstimate(row),projection=projectionStatus(row);
  const measured=row.state==='measured'&&row.measured!==null;
  const allowance=row.allowance===null?row.allowanceLabel:amount(row.allowance,row.unit);
  const context=row.id.startsWith('bazaarsignal-510305-')?'Market service':row.id.startsWith('bazaarsignal-')?'Website & alerts':null;
  return <article className={`usage-card ${attention?'attention':''} ${tone(status)}`} aria-label={`${row.resource}${context?` · ${context}`:''}`}>
    <div className="usage-card-heading"><div><h4>{row.resource}</h4>{context&&<small>{context}</small>}</div><span className={`usage-badge ${tone(status)}`}>{status}</span></div>
    <p className="usage-period">{windowLabel(row)}{expired?' · report out of date':''}</p>
    <p className="usage-amount"><strong>{measured?amount(row.measured,row.unit):'Unknown'}</strong><span>{row.allowance!==null?`of ${allowance}`:allowance}</span></p>
    {measured&&percent!==null&&status!=='Unknown'&&<div className="usage-meter" role="progressbar" aria-label={`${row.resource} measured allowance use`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,percent)} aria-valuetext={`${percent.toFixed(1)}% of allowance`}><span style={{width:`${Math.min(100,percent)}%`}} /></div>}
    <p className="usage-reset">{row.id==='scheduler'?'No counter reset · paused jobs still count':kind==='capacity'?'No reset · changes as resources are removed':kind==='rolling'?'Reset time not exposed by Google':`Resets ${date(row.resetAt??row.periodEnd)}`}</p>
    {row.id==='builds'&&<p className="usage-reset">Deployment regions only · eligible default-pool allowance</p>}
    {row.allowanceComparable===false&&<p className="usage-coverage-reason">Includes machine types outside this allowance. Usage is measured; allowance eligibility is unknown.</p>}
    {attention&&<p className="usage-action">{row.id==='images'?'Review retained images at your next cleanup review. Preserve the active image and any rollback images you need.':status==='Over allowance'?`Review ${kind==='daily'?"today’s":kind==='capacity'?'stored':'this month’s'} usage before adding more work.`:projection==='Over allowance'||projection==='Getting close'?`The ${kind==='daily'?'day-end':'month-end'} estimate is approaching or above the allowance. Check the trend before increasing usage.`:'Usage has reached 80% of the allowance. Review before adding more work.'}</p>}
    {estimate!==null&&estimate>0&&<p className="usage-estimate"><b>Storage-only estimate: ≈ ${estimate.toFixed(3)} USD/month</b><span>If this capacity stays unchanged for a typical month, with the full 0.5 GiB allowance available. Not an actual charge; excludes transfer, scans and other projects.</span></p>}
    {attention&&row.projected!==null&&!expired&&<p className="usage-projection"><b>Estimated {kind==='daily'?'day-end':'month-end'}:</b> {amount(row.projected,row.unit)}<small>Projected: {projection}. Current average rate; separate from measured usage above.</small></p>}
    {!measured&&<p className="usage-coverage-reason">{row.coverageDetail??'No reliable measurement is available. Missing data does not mean zero usage.'}</p>}
    <details className="usage-details"><summary>Details{!attention&&row.projected!==null?' & projection':''}</summary>
      <p>{row.purpose}</p>
      {!attention&&row.projected!==null&&<p><b>Estimated {kind==='daily'?'day-end':'month-end'}:</b> {amount(row.projected,row.unit)}. Extrapolated from the average reported rate; not measured usage.</p>}
      <dl><dt>Allowance</dt><dd>{row.allowanceLabel}</dd><dt>Scope</dt><dd>{row.scope}</dd><dt>Project</dt><dd>{row.project}</dd><dt>Measured at</dt><dd>{date(row.measuredAt)}</dd><dt>Source</dt><dd>{row.source}</dd></dl>
      {row.budget!==null&&<p><b>Application safeguard:</b> {amount(row.reservation,row.unit)} reserved of {amount(row.budget,row.unit)}. {row.reservationPeriod}. Reservations include margins and are not measured Google usage.</p>}
      <p>{row.note}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer">Allowance documentation</a>
    </details>
  </article>;
}

export default function UsageDashboard({user}:{user:User|null}) {
  const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refreshAt,setRefreshAt]=useState(0),[now,setNow]=useState(Date.now());
  const allowed=ownerCandidate(user);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    setData(null);setError('');setRefreshAt(0);
    if(!allowed||!user)return;
    const controller=new AbortController();void load(controller.signal);
    return()=>controller.abort();
  },[user?.uid,allowed]);
  async function load(signal?:AbortSignal) {
    if(!user||!allowed)return;
    setBusy(true);setError('');
    try {
      const token=await user.getIdToken();
      const base=(import.meta.env.VITE_MARKET_API_URL??'').replace(/\/$/,'');
      const r=await fetch(`${base}/api/owner/usage`,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error(r.status===401?'Your session expired. Sign in again.':r.status===403?'Access denied.':r.status===429?'Please wait before refreshing.':'Usage measurements are unavailable. The reporting service may be paused or temporarily unreachable.');
      const result=await r.json() as Dashboard;
      if(!signal?.aborted && auth?.currentUser?.uid===user.uid)setData(verifiedUsageSnapshot(result));
    }catch(e){if(!signal?.aborted && auth?.currentUser?.uid===user.uid){setData(null);setError(e instanceof Error?e.message:'Usage unavailable.');}}
    finally{if(!signal?.aborted){setBusy(false);setRefreshAt(Date.now()+60_000);}}
  }
  if(!allowed)return <section className="usage-page"><h2>Owner access required</h2><p>Sign in with the authorized Google account to open this page.</p></section>;
  const stale=!!data&&(!!data.stale||now>=data.nextMeasurementAt);
  const rows=sortResources(data?.rows??[],stale);
  const attention=rows.filter(r=>needsAttention(r,stale||expiredRow(r,now)));
  const missing=rows.filter(r=>r.state!=='measured'||r.measured===null);
  const rest=rows.filter(r=>!attention.includes(r)&&!missing.includes(r));
  const groups=Object.entries(coverageLabels).map(([key,label])=>({label,rows:missing.filter(r=>(r.coverage??(r.state==='not-reported'?'delay':'setup'))===key)})).filter(g=>g.rows.length);
  return <section className="usage-page" aria-labelledby="usage-title">
    <div className="usage-heading"><div><span className="usage-eyebrow">OWNER ONLY</span><h2 id="usage-title">Usage &amp; Costs</h2><p>What needs attention, and when.</p></div><button className="button blue" disabled={busy||now<refreshAt} onClick={()=>void load()}>{busy?'Loading…':now<refreshAt?`Refresh in ${Math.ceil((refreshAt-now)/1000)}s`:'Refresh status'}</button></div>
    {error&&<p className="notice warning" role="alert">{error}</p>}
    {!data&&busy&&<p role="status">Verifying owner access and loading cached measurements…</p>}
    {data&&<>
      <div className="usage-summary">
        <article className={attention.length||stale?'usage-warning':''}><span>Allowance overview</span><strong>{stale?'Report out of date':attention.length?`${attention.length} ${attention.length===1?'resource needs':'resources need'} attention`:'No reported allowance warnings'}</strong><p>{stale?'Refresh the cached report before relying on its statuses.':`${data.rows.filter(r=>r.state==='measured').length} of ${data.rows.length} resources measured. Statuses apply to the reported scope.`}</p></article>
        <article className={data.collection.state==='Active'?'':'usage-warning'}><span>Market collection</span><strong>{data.collection.state}</strong><p>Fixed stop: <b>{date(data.collection.reviewAt)}</b></p></article>
        <article className="usage-neutral"><span>Actual spending this month</span><strong>Unknown</strong><p>No billing records connected. Measured usage and estimates do not establish actual spending.</p><details><summary>Billing setup</summary><p>Connect an existing Cloud Billing cost export with read access and bounded query permission. No export was found during inspection.</p><p>No billing or paid service is enabled by this dashboard.</p><a href={data.spending.sourceUrl} target="_blank" rel="noreferrer">Billing export documentation</a><small>Checked {date(Date.parse(data.spending.checkedAt))}. Available-history spending is also unknown.</small></details></article>
      </div>
      {missing.length>0&&<details className="usage-coverage"><summary><b>Coverage: {missing.length} unknown measurements</b><span>{groups.map(g=>`${g.rows.length} ${g.label.toLowerCase()}`).join(' · ')}. Unknown usage is not confirmed within allowance.</span></summary>
        {groups.map(g=><section key={g.label}><h3>{g.label}</h3><div className="usage-grid">{g.rows.map(row=><ResourceCard key={row.id} row={row} stale={stale} now={now}/>)}</div></section>)}
      </details>}
      {attention.length>0&&<section aria-labelledby="usage-attention"><h3 id="usage-attention">Needs attention</h3><div className="usage-grid">{attention.map(row=><ResourceCard key={row.id} row={row} stale={stale} now={now}/>)}</div></section>}
      <section aria-labelledby="usage-resources"><h3 id="usage-resources">{attention.length?'Other resources':'Resources'}</h3><p className="usage-section-note">Current reported usage. Estimates appear separately. Daily limits reset at Pacific midnight; stored capacity has no reset.</p><div className="usage-grid">{rest.map(row=><ResourceCard key={row.id} row={row} stale={stale} now={now}/>)}</div></section>
      <details className="usage-operations"><summary>Report sources &amp; collection safeguards</summary><p>Report saved {date(data.generatedAt)}. Next measurement eligible {date(data.nextMeasurementAt)}. Refreshes reuse the shared 30-minute cache and never collect market data.</p><p>{data.collection.reason} Scheduler: {data.collection.scheduler}. Last successful source check: {date(data.collection.lastSuccessAt)}. Next due: {date(data.collection.nextCollectionAt)}.</p><p>Application budget pressure: {data.collection.pressure===null?'Unknown':`${(100*data.collection.pressure).toFixed(1)}%`}. Warning at 50%, slowdown at 65%, pause on exhausted budget. {data.collection.cleanup}.</p><p>Google reporting can be delayed. Projections extend the reported average through the period and can vary sharply early in the month. Billing-account allowances may also be used by other projects; displayed usage cannot certify account-wide headroom. Free allowances are not spending caps.</p><p>If fixed-deadline shutdown removes API access, this reporting service also becomes unavailable. Review through authorized Google tools; this page cannot resume collection.</p></details>
    </>}
  </section>;
}
