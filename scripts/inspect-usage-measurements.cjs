const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
 const get=async(url)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});return r.json();};
 const out={};
 for(const type of ['run.googleapis.com/container/cpu/allocation_time','run.googleapis.com/container/memory/allocation_time','artifactregistry.googleapis.com/repository/size','firebasehosting.googleapis.com/network/monthly_sent_limit']){
   const project=type.startsWith('firebase')?'bazaarsignal':'bazaarsignal-510305';
   const descriptor=await get(`https://monitoring.googleapis.com/v3/projects/${project}/metricDescriptors/${type}`);
   const q=new URLSearchParams({filter:`metric.type="${type}"`,'interval.startTime':new Date(Date.now()-2*3600000).toISOString(),'interval.endTime':new Date().toISOString(),pageSize:'1000'});
   const values=await get(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`);
   out[type]={unit:descriptor.unit,description:descriptor.description,series:values.timeSeries?.map(s=>({metric:s.metric,resource:s.resource,points:s.points.slice(0,2)})),error:values.error};
 }
 const scope=await get('https://cloudbilling.googleapis.com/v1/billingAccounts/012803-EA91BE-8DCD32/projects');
 out.billingScope=scope;
 out.datasets={};
 for(const p of scope.projectBillingInfo??[])out.datasets[p.projectId]=await get(`https://bigquery.googleapis.com/bigquery/v2/projects/${p.projectId}/datasets?all=true&maxResults=100`);
 fs.writeFileSync('.local/usage-meter-inspection.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
