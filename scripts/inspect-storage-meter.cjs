const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
 const q=new URLSearchParams({filter:'metric.type="firestore.googleapis.com/storage/data_and_index_storage_bytes" AND resource.labels.project_id="bazaarsignal"',view:'FULL','interval.startTime':new Date(Date.now()-3*86400000).toISOString(),'interval.endTime':new Date().toISOString(),pageSize:'10000'});
 const r=await fetch(`https://monitoring.googleapis.com/v3/projects/bazaarsignal/timeSeries?${q}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
 const body=await r.text(),data=JSON.parse(body);
 const report={at:new Date().toISOString(),status:r.status,characters:body.length,error:data.error,more:!!data.nextPageToken,series:data.timeSeries?.map(s=>({labels:s.metric.labels,points:s.points.length,latest:s.points[0]}))};
 fs.writeFileSync('.local/usage-storage-inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
