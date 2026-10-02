// Targeted reads for unresolved billing evidence; preserves old reports.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const gapsOnly=process.argv.includes('--gaps-only');
 const explicitStart=process.argv.find(a=>a.startsWith('--start='))?.slice('--start='.length);
 if(gapsOnly&&!explicitStart)throw new Error('The targeted recheck requires an explicit --start ISO period boundary');
 if(explicitStart&&!Number.isFinite(Date.parse(explicitStart)))throw new Error('Invalid period boundary');
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 if(!account)throw new Error('Expected account unavailable');
 const token=await auth.getAccessToken(account.tokens.refresh_token,[]),now=new Date();
 const out={at:now.toISOString(),start:explicitStart??new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(),apiCalls:0,metrics:{},errors:[]};
 if(Date.parse(out.start)>=now.getTime())throw new Error('Period has not started');
 async function get(url){out.apiCalls++;const r=await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'error',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error?.message}`);return data;}
 const plans=[
  ...['read_ops_count','write_ops_count','delete_ops_count'].map(s=>({project:'bazaarsignal-510305',type:`firestore.googleapis.com/document/${s}`})),
  {project:'bazaarsignal-510305',type:'monitoring.googleapis.com/billing/time_series_billed_for_queries_count'},
  ...['firestore.googleapis.com','monitoring.googleapis.com'].map(service=>({project:'bazaarsignal-510305',type:'serviceruntime.googleapis.com/api/response_sizes',extra:` AND resource.labels.service="${service}"`,distribution:true})),
  ...['hip-fusion-451104-t5','nail-salon-app-457601'].flatMap(project=>['run.googleapis.com/container/cpu/allocation_time','storage.googleapis.com/api/request_count'].map(type=>({project,type}))),
 ];
 const selected=gapsOnly?plans.filter(p=>p.project==='bazaarsignal-510305'&&(
   p.type.endsWith('/delete_ops_count')||p.type.endsWith('/time_series_billed_for_queries_count')||
   (p.distribution&&p.extra.includes('firestore.googleapis.com')))):plans;
 for(const plan of selected){
  const key=`${plan.project}:${plan.type}${plan.extra??''}`;
  try{
   const q=new URLSearchParams({filter:`metric.type="${plan.type}"${plan.extra??''}`,'interval.startTime':out.start,'interval.endTime':out.at,pageSize:'1000',...(!plan.distribution?{'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':'ALIGN_SUM'}:{})});
   const data=await get(`https://monitoring.googleapis.com/v3/projects/${plan.project}/timeSeries?${q}`);
   out.metrics[key]=data;if(data.nextPageToken)out.errors.push(`${key}: incomplete pagination`);
  }catch(e){out.errors.push(`${key}: ${e.message}`);}
 }
 const path=`.local/trial-missing-meters-${out.at.replace(/[:.]/g,'-')}.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2),{flag:'wx'});
 console.log(JSON.stringify({path,at:out.at,start:out.start,apiCalls:out.apiCalls,metrics:Object.fromEntries(Object.entries(out.metrics).map(([key,value])=>[key,{series:value.timeSeries?.length??0,points:value.timeSeries?.reduce((n,s)=>n+s.points.length,0)??0,sum:value.timeSeries?.reduce((n,s)=>n+s.points.reduce((n,p)=>n+Number(p.value.int64Value??p.value.doubleValue??(p.value.distributionValue?.mean??0)*(p.value.distributionValue?.count??0)),0),0)??null}])),errors:out.errors},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
