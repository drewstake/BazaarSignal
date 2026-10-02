// Read-only diagnosis; return only aggregate measurement fields, never user records.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
 const get=async(url,body)=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};};
 const report={at:new Date().toISOString()};
 const worker=await get('https://firestore.googleapis.com/v1/projects/bazaarsignal/databases/(default)/documents/backend/worker');
 const w=JSON.parse(worker.data.fields?.json?.stringValue??'null');
 report.worker={status:worker.status,updateTime:worker.data.updateTime,quota:w?.monitor?.quota,lastAttempt:w?.monitor?.lastAttempt,runtimeMs:w?.runtimeMs,runtimeWindow:w?.runtimeWindow};
 const builds=await get('https://cloudbuild.googleapis.com/v1/projects/bazaarsignal-510305/locations/-/builds?pageSize=100');
 report.builds={status:builds.status,error:builds.data.error,more:!!builds.data.nextPageToken,builds:builds.data.builds?.map(b=>({id:b.id,status:b.status,start:b.startTime,finish:b.finishTime,options:b.options}))};
 report.iam={};
 for(const p of ['bazaarsignal','bazaarsignal-510305']){
   const policy=await get(`https://cloudresourcemanager.googleapis.com/v1/projects/${p}:getIamPolicy`,{options:{requestedPolicyVersion:3}});
   report.iam[p]=policy.data.bindings?.filter(b=>b.members?.includes('serviceAccount:market-reader@bazaarsignal-510305.iam.gserviceaccount.com'));
 }
 report.sparseMetrics=[];
 for(const [project,type] of [['bazaarsignal','firestore.googleapis.com/document/delete_ops_count'],['bazaarsignal-510305','firestore.googleapis.com/document/delete_ops_count'],['bazaarsignal','logging.googleapis.com/billing/bytes_ingested']]){
   const q=new URLSearchParams({filter:`metric.type="${type}"`,'interval.startTime':new Date(Date.now()-7*86400000).toISOString(),'interval.endTime':new Date().toISOString(),view:'HEADERS',pageSize:'1'});
   const d=await get(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`);
   report.sparseMetrics.push({project,type,status:d.status,hasSeries:!!d.data.timeSeries?.length,more:!!d.data.nextPageToken,error:d.data.error?.message});
 }
 fs.writeFileSync('.local/usage-gaps-inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
