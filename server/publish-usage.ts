import { ownerUsagePath, publishableUsageReport, parseUsageReport } from '../shared/published-usage';
import type { UsageDashboard } from '../shared/usage-dashboard';

/** Only an explicit operator command calls this. One CAS publication in the
 * already protected owner namespace; no rules, IAM, ledger or scheduler writes. */
export async function publishOwnerUsage(snapshot: UsageDashboard, request: (url:string, init?:RequestInit)=>Promise<Response>) {
  const root='https://firestore.googleapis.com/v1/projects/bazaarsignal/databases/(default)/documents';
  const get=async(url:string)=>{
    const response=await request(url);
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`Report read failed: HTTP ${response.status}`);
    return response.json();
  };
  const access=await get(`${root}/config/access`);
  const path=ownerUsagePath(access?.fields?.ownerUid?.stringValue ?? '');
  const url=`${root}/${path}`, before=await get(url);
  const report=publishableUsageReport(snapshot), json=JSON.stringify(report);
  if(before?.fields?.json?.stringValue===json)return {path,changed:false,generatedAt:report.generatedAt};
  if(before && parseUsageReport(before.fields?.json?.stringValue).generatedAt>=report.generatedAt)
    throw new Error('A report with this timestamp or a newer timestamp is already published.');
  const query=new URLSearchParams(before?{'currentDocument.updateTime':before.updateTime}:{'currentDocument.exists':'false'});
  const response=await request(`${url}?${query}`,{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fields:{schema:{integerValue:'1'},json:{stringValue:json}}})});
  if(!response.ok)throw new Error(`Report publication failed: HTTP ${response.status}; no automatic retry.`);
  const after=await get(url);
  if(after?.fields?.json?.stringValue!==json)throw new Error('Report publication could not be verified; preserve the receipt.');
  return {path,changed:true,generatedAt:report.generatedAt};
}
