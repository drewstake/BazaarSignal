import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../data';
import { localWorkspace } from '../local-workspace';
import type { UsageDashboard as Dashboard, UsageRow } from '../../shared/usage-dashboard';
import { verifiedUsageSnapshot } from '../../shared/usage-dashboard';
import { currentStatus, imageStorageEstimate, kindOf, needsAttention, projectionStatus, sortResources } from '../../shared/usage-presentation';
import './usage-dashboard.css';
import { ownerCandidate } from './usage-access';
import { BlockMeter, PixelIcon } from './ui/Pixel';
import type { PixelGlyph } from './ui/pixel-glyphs';
import { CoinIcon, InfoNote, PageHeading } from './pages/common';

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

function metricLine(row:UsageRow,expired:boolean) {
  const context=row.id.startsWith('bazaarsignal-510305-')?' (Market service)':row.id.startsWith('bazaarsignal-')?' (Website & alerts)':'';
  const measured=row.state==='measured'?row.measured:null,total=row.allowanceComparable===false?null:row.allowance;
  const value=(n:number|null)=>n===null||!Number.isFinite(n)?'Unknown':n.toLocaleString(undefined,{maximumFractionDigits:2});
  // Scale each byte value independently so small nonzero usage never rounds to 0 GiB.
  const ratio=(used:number|null,limit:number|null)=>row.unit==='bytes'?`${amount(used,row.unit)} / ${amount(limit,row.unit)}`:`${value(used)} / ${value(limit)} ${row.unit}`;
  const reserved=row.budget!==null?`; app reserved: ${ratio(row.reservation,row.budget)}`:'';
  return `${row.resource}${context}: ${ratio(measured,total)} (measured / Google allowance)${reserved}${expired?' [report out of date]':''}`;
}

const contextOf=(row:UsageRow)=>row.id.startsWith('bazaarsignal-510305-')?'Market service':row.id.startsWith('bazaarsignal-')?'Website & alerts':null;
function resourceIcon(row:UsageRow):PixelGlyph {
  const id=row.id;
  if(id==='run-cpu'||id==='run-memory')return 'cpu';
  if(id==='images'||id==='builds')return 'cube';
  if(id==='scheduler'||id==='script-runtime')return 'clock';
  if(id==='script-mail')return 'mail';
  if(id==='auth')return 'key';
  if(id==='script-fetch')return 'open';
  if(/request|network|transfer/.test(id))return 'cloud';
  return 'database';
}
const plain=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:2});

function ResourceRow({row,stale,now}:{row:UsageRow;stale:boolean;now:number}) {
  const expired=stale||expiredRow(row,now);
  const status=currentStatus(row,expired),attention=needsAttention(row,expired),kind=kindOf(row);
  const percent=row.measured!==null&&row.allowance?row.measured/row.allowance*100:null;
  const estimate=imageStorageEstimate(row),projection=projectionStatus(row);
  const measured=row.state==='measured'&&row.measured!==null;
  const bytes=row.unit==='bytes',context=contextOf(row);
  const used=measured?(bytes?amount(row.measured,row.unit):plain(row.measured!)):'Unknown';
  const limit=row.allowance===null?null:bytes?amount(row.allowance,row.unit):plain(row.allowance);
  const reset=row.id==='scheduler'?'No counter reset · paused jobs still count':kind==='capacity'?'No reset · changes as resources are removed':kind==='rolling'?'Reset time not exposed by Google':`Resets ${date(row.resetAt??row.periodEnd)}`;
  const shortReset=row.id==='scheduler'?'no counter reset':kind==='capacity'?'no reset':kind==='rolling'?'reset time not exposed':`resets ${date(row.resetAt??row.periodEnd)}`;
  return <article className={`usage-row ${tone(status)}${attention?' attention':''}`} aria-label={`${row.resource}${context?` · ${context}`:''}`}>
    <div className="usage-row-main">
      <span className="usage-row-icon"><PixelIcon name={resourceIcon(row)} size={28}/></span>
      <div className="usage-row-name"><h4>{row.resource}</h4><small>{context?`${context} · `:''}{windowLabel(row)} · {expired?'report out of date':shortReset}</small></div>
      <div className="usage-row-meter">{measured&&percent!==null&&status!=='Unknown'
        ?<BlockMeter value={row.measured!} max={row.allowance!} label={`${row.resource} measured allowance use`} tone={status==='Over allowance'?'over':status==='Getting close'?'close':'ok'}/>
        :<span className="meter-unknown" aria-hidden="true">{Array.from({length:12},(_,i)=><span key={i}/>)}</span>}</div>
      <div className="usage-row-amount">
        <p><strong>{used}</strong>{limit!==null&&<span> / {limit}</span>}</p>
        <small>{row.allowance===null?row.allowanceLabel:bytes?'measured / allowance':`${row.unit} · measured / allowance`}</small>
      </div>
      <span className={`usage-badge ${tone(status)}`}>{status}</span>
    </div>
    <div className="usage-row-notes">
      {row.allowanceComparable===false&&<p className="usage-coverage-reason">Includes machine types outside this allowance. Usage is measured; allowance eligibility is unknown.</p>}
      {!measured&&<p className="usage-coverage-reason">{row.coverageDetail??'No reliable measurement is available. Missing data does not mean zero usage.'}</p>}
      {attention&&<p className="usage-action"><PixelIcon name="warning" size={14}/>{row.id==='images'?'Review retained images at your next cleanup review. Preserve the active image and any rollback images you need.':status==='Over allowance'?`Review ${kind==='daily'?"today’s":kind==='capacity'?'stored':'this month’s'} usage before adding more work.`:projection==='Over allowance'||projection==='Getting close'?`The ${kind==='daily'?'day-end':'month-end'} estimate is approaching or above the allowance. Check the trend before increasing usage.`:'Usage has reached 80% of the allowance. Review before adding more work.'}</p>}
      {estimate!==null&&estimate>0&&<p className="usage-estimate"><b>Storage-only estimate: ≈ ${estimate.toFixed(3)} USD/month</b><span>If this capacity stays unchanged for a typical month, with the full 0.5 GiB allowance available. Not an actual charge; excludes transfer, scans and other projects.</span></p>}
      {attention&&row.projected!==null&&!expired&&<p className="usage-projection"><b>Estimated {kind==='daily'?'day-end':'month-end'}:</b> {amount(row.projected,row.unit)}<small>Projected: {projection}. Current average rate; separate from measured usage above.</small></p>}
    </div>
    <details className="usage-details"><summary>Details{!attention&&row.projected!==null?' & projection':''}</summary>
      <p>{row.purpose}</p>
      <p>{reset}{row.id==='builds'?' · deployment regions only, eligible default-pool allowance':''}.</p>
      {!attention&&row.projected!==null&&<p><b>Estimated {kind==='daily'?'day-end':'month-end'}:</b> {amount(row.projected,row.unit)}. Extrapolated from the average reported rate; not measured usage.</p>}
      {row.budget!==null&&<p><b>App safety budget · reserved:</b> {amount(row.reservation,row.unit)} of {amount(row.budget,row.unit)}. Set aside as a precaution; not measured usage. {row.reservationPeriod}.</p>}
      <dl><dt>Google allowance</dt><dd>{row.allowanceLabel}</dd><dt>Scope</dt><dd>{row.scope}</dd><dt>Project</dt><dd>{row.project}</dd><dt>Measured at</dt><dd>{date(row.measuredAt)}</dd><dt>Source</dt><dd>{row.source}</dd></dl>
      <p>{row.note}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer">Allowance documentation</a>
    </details>
  </article>;
}

function collectionIcon(state:string,stale:boolean):PixelGlyph {
  if(stale)return 'warning';
  if(state==='Active')return 'check';
  return /pause|stop|wait/i.test(state)?'pause':'warning';
}

export default function UsageDashboard({user}:{user:User|null}) {
  const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refreshAt,setRefreshAt]=useState(0),[now,setNow]=useState(Date.now());
  const [copyStatus,setCopyStatus]=useState('');
  useEffect(()=>{if(!copyStatus)return;const timer=setTimeout(()=>setCopyStatus(''),3000);return()=>clearTimeout(timer);},[copyStatus]);
  const allowed=ownerCandidate(user);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    setData(null);setError('');setRefreshAt(0);setCopyStatus('');
    if(!allowed||!user)return;
    const controller=new AbortController();void load(controller.signal);
    return()=>controller.abort();
  },[user?.uid,allowed]);
  async function load(signal?:AbortSignal) {
    if(!user||!allowed)return;
    setBusy(true);setError('');
    try {
      const token=await user.getIdToken();
      const base=localWorkspace?'':(import.meta.env.VITE_MARKET_API_URL??'').replace(/\/$/,'');
      const r=await fetch(`${base}/api/owner/usage`,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error(r.status===401?'Your session expired. Sign in again.':r.status===403?'Access denied.':r.status===429?'Please wait before refreshing.':localWorkspace?'No saved cloud report is available on this computer. Live reporting remains paused; usage is unknown.':'Usage measurements are unavailable. The reporting service may be paused or temporarily unreachable.');
      const result=await r.json() as Dashboard;
      if(!signal?.aborted && auth?.currentUser===user)setData(verifiedUsageSnapshot(result));
    }catch(e){if(!signal?.aborted && auth?.currentUser===user){setData(null);setError(e instanceof TypeError?'Cannot reach the usage reporting service. Collection remains paused; no usage measurements were inferred.':e instanceof Error?e.message:'Usage unavailable.');}}
    finally{if(!signal?.aborted && auth?.currentUser===user){setBusy(false);setRefreshAt(Date.now()+60_000);}}
  }
  async function copyMetrics() {
    if(!data||busy)return;
    try {
      await navigator.clipboard.writeText(data.rows.map(row=>metricLine(row,!!data.stale||now>=data.nextMeasurementAt||expiredRow(row,now))).join('\n'));
      setCopyStatus('Copied!');
    } catch {setCopyStatus('Could not copy. Try again.');}
  }
  if(!allowed)return <section className="ledger-card narrow-card"><h1 className="card-title">Owner access required</h1><p>Sign in with the authorized Google account to open this page.</p></section>;
  const stale=!!data&&(!!data.stale||now>=data.nextMeasurementAt);
  const rows=sortResources(data?.rows??[],stale);
  const attention=rows.filter(r=>needsAttention(r,stale||expiredRow(r,now)));
  const missing=rows.filter(r=>r.state!=='measured'||r.measured===null);
  const rest=rows.filter(r=>!attention.includes(r)&&!missing.includes(r));
  const reserved=rows.filter(r=>r.budget!==null);
  const groups=Object.entries(coverageLabels).map(([key,label])=>({label,rows:missing.filter(r=>(r.coverage??(r.state==='not-reported'?'delay':'setup'))===key)})).filter(g=>g.rows.length);
  const c=data?.collection;
  return <section className="usage-page" aria-labelledby="usage-title">
    <PageHeading title="Usage & Costs" id="usage-title" badge={<span className="owner-badge"><PixelIcon name="lock" size={14}/>Owner only</span>}>
      <div className="usage-heading-actions">
        <button className="button" disabled={busy||now<refreshAt} onClick={()=>void load()}><PixelIcon name="refresh"/>{busy?'Loading…':now<refreshAt?`Refresh in ${Math.ceil((refreshAt-now)/1000)}s`:'Refresh status'}</button>
        <button className="button" disabled={!data||busy} onClick={()=>void copyMetrics()}><PixelIcon name="copy"/>Copy metrics</button>
        <span className="usage-copy-status" role="status">{copyStatus}</span>
      </div>
    </PageHeading>
    {error&&<p className="banner warn" role="alert"><PixelIcon name="warning" size={18}/><span>{error}</span></p>}
    {data?.localReport&&<InfoNote>{data.localReport}</InfoNote>}
    {!data&&busy&&<p role="status" className="loading-line">Verifying owner access and loading cached measurements…</p>}
    {data&&c&&<>
      <div className="usage-top">
        <article className={`ledger-card usage-status ${!stale&&c.state==='Active'?'ok':'warn'}`}>
          <span className="usage-status-icon"><PixelIcon name={collectionIcon(c.state,stale)} size={30}/></span>
          <div>
            <p className="usage-eyebrow">Market collection</p>
            <h2>{stale?'Current state unknown':c.state}</h2>
            {stale?<p>Last reported: <b>{c.state}</b> at {date(c.measuredAt)}.</p>:c.state!=='Active'&&<p>{c.reason}</p>}
            {!stale&&c.state==='Waiting for budget'&&<p>Next eligible collection: <b>{date(c.nextCollectionAt)}</b>.</p>}
            <p className="usage-status-facts">
              <span>App safety budget use: <b>{c.pressure===null?'Unknown':`${(100*c.pressure).toFixed(1)}%`}</b>{stale?' · report out of date':''}</span>
              <span>{c.hourlyTrialEndsAt?<>{stale?'Reported hourly test end':'Hourly test ends'} <b>{date(c.hourlyTrialEndsAt)}</b>. Collections skip before exceeding 95% reserved; hard limits still apply.</>:'Updates slow at 65% reserved.'}</span>
              <span>{stale?'Reported fixed stop':'Fixed stop'}: <b>{date(c.reviewAt)}</b></span>
            </p>
          </div>
        </article>
        <article className="ledger-card usage-spend">
          <p className="usage-eyebrow">Actual spending this month</p>
          <p className="usage-spend-value"><CoinIcon size={30}/><strong>Unknown</strong></p>
          <p>No billing records connected. Measured usage and estimates do not establish actual spending.</p>
          <details><summary>Billing setup</summary><p>Connect an existing Cloud Billing cost export with read access and bounded query permission. No export was found during inspection.</p><p>No billing or paid service is enabled by this dashboard.</p><a href={data.spending.sourceUrl} target="_blank" rel="noreferrer">Billing export documentation</a><small>Checked {date(Date.parse(data.spending.checkedAt))}. Available-history spending is also unknown.</small></details>
        </article>
      </div>
      <div className="usage-columns">
        <section className="ledger-card usage-measured" aria-labelledby="usage-measured-title">
          <div className="usage-panel-head">
            <h2 id="usage-measured-title">Measured usage</h2>
            <span className={`usage-overview ${attention.length||stale?'warn':'ok'}`}>{stale?'Report out of date':attention.length?`${attention.length} ${attention.length===1?'resource needs':'resources need'} attention`:'No reported allowance warnings'}</span>
          </div>
          <p className="usage-panel-sub">{stale?'Refresh the cached report before relying on its statuses.':`${data.rows.filter(r=>r.state==='measured').length} of ${data.rows.length} resources measured. Statuses apply to the reported scope.`}</p>
          {attention.length>0&&<section aria-labelledby="usage-attention" className="usage-group"><h3 id="usage-attention">Needs attention</h3>{attention.map(row=><ResourceRow key={row.id} row={row} stale={stale} now={now}/>)}</section>}
          <section aria-labelledby="usage-resources" className="usage-group"><h3 id="usage-resources" className={attention.length?undefined:'sr-only'}>{attention.length?'Other resources':'Resources'}</h3>
            {rest.length?rest.map(row=><ResourceRow key={row.id} row={row} stale={stale} now={now}/>):<p className="muted">No other measured resources in this report.</p>}
          </section>
          <InfoNote><p><b>Two different limits.</b> Google allowance compares reported usage with Google's published allowance. App safety budget tracks amounts set aside as a precaution and can slow updates before the Google allowance is used. Daily limits reset at Pacific midnight; stored capacity has no reset.</p></InfoNote>
        </section>
        <section className="ledger-card usage-reserved" aria-labelledby="usage-reserved-title">
          <div className="usage-panel-head"><h2 id="usage-reserved-title">Reserved budget</h2></div>
          <p className="usage-panel-sub">App safety allowances, separate from Google allowances and billing budgets.</p>
          {reserved.length?<ul className="reserved-list">{reserved.map(r=>{const ctx=contextOf(r);return <li key={r.id}>
            <span className="reserved-name"><b>{r.resource}</b><small>{ctx?`${ctx} · `:''}{r.reservationPeriod}</small></span>
            <span className="reserved-amount"><b>{amount(r.reservation,r.unit)}</b><small>of {amount(r.budget,r.unit)} reserved</small></span>
          </li>;})}</ul>:<p className="muted">No app safety budgets in this report.</p>}
          <p className="reserved-pressure">Budget use: <b>{c.pressure===null?'Unknown':`${(100*c.pressure).toFixed(1)}%`}</b></p>
          <p className="usage-panel-note">Reserved amounts are set aside as a precaution. They are not extra usage and should not be added to measured usage.</p>
        </section>
      </div>
      {missing.length>0&&<details className="usage-coverage ledger-card"><summary><b>Coverage: {missing.length} unknown measurements</b><span>{groups.map(g=>`${g.rows.length} ${g.label.toLowerCase()}`).join(' · ')}. Unknown usage is not confirmed within allowance.</span></summary>
        {groups.map(g=><section key={g.label} className="usage-group"><h3>{g.label}</h3><div className="usage-grid">{g.rows.map(row=><ResourceRow key={row.id} row={row} stale={stale} now={now}/>)}</div></section>)}
      </details>}
      <details className="usage-operations ledger-card"><summary>Report sources &amp; collection safeguards</summary><p>Report saved {date(data.generatedAt)}. Next measurement eligible {date(data.nextMeasurementAt)}. Refreshes reuse the shared 30-minute cache and never collect market data.</p><p>{c.reason} Scheduler: {c.scheduler}. Last successful source check: {date(c.lastSuccessAt)}. Next due: {date(c.nextCollectionAt)}.</p><p>Application budget pressure: {c.pressure===null?'Unknown':`${(100*c.pressure).toFixed(1)}%`}. Normally: warning at 50%, slowdown at 65%, pause on exhausted budget. {c.hourlyTrialEndsAt?`The temporary hourly test ends ${date(c.hourlyTrialEndsAt)} and skips collections before 95% reserved. `:''}{c.cleanup}.</p><p>Google reporting can be delayed. Projections extend the reported average through the period and can vary sharply early in the month. Billing-account allowances may also be used by other projects; displayed usage cannot certify account-wide headroom. Free allowances are not spending caps.</p><p>If fixed-deadline shutdown removes API access, this reporting service also becomes unavailable. Review through authorized Google tools; this page cannot resume collection.</p></details>
    </>}
  </section>;
}
