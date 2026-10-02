// Read-only bounded inventory of the collector database and relevant metric
// descriptors. Never substitutes an absent billing series with zero.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async()=>{
 const project='bazaarsignal-510305',root=`projects/${project}`;
 const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 if(!account)throw new Error('Expected deployment account unavailable');
 const token=await auth.getAccessToken(account.tokens.refresh_token,[]);
 const report={at:new Date().toISOString(),project,apiCalls:0,documentListPages:0,documents:[],collections:[],descriptors:[],errors:[]};
 async function call(url,body){
  if(++report.apiCalls>60)throw new Error('Bounded inventory call limit reached');
  const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(`${response.status}: ${data.error?.message}`);return data;
 }
 const database=`https://firestore.googleapis.com/v1/${root}/databases/(default)`;
 try{
  const queue=[`${database}/documents`];
  while(queue.length){
   const parent=queue.shift();let pageToken;
   do{
    const page=await call(`${parent}:listCollectionIds`,{pageSize:100,...(pageToken?{pageToken}:{})});
    for(const id of page.collectionIds??[]){
     const collection=`${parent}/${encodeURIComponent(id)}`;report.collections.push(collection.split('/documents/')[1]);
     let documentsPage;
     do{
      report.documentListPages++;
      const q=new URLSearchParams({pageSize:'100',showMissing:'true',...(documentsPage?{pageToken:documentsPage}:{})});
      const data=await call(`${collection}?${q}`);
      for(const doc of data.documents??[]){
       report.documents.push({name:doc.name,createTime:doc.createTime,updateTime:doc.updateTime,jsonBytes:Buffer.byteLength(JSON.stringify(doc)),fieldNames:Object.keys(doc.fields??{})});
       queue.push(`https://firestore.googleapis.com/v1/${doc.name}`);
      }
      if(report.documents.length>256)throw new Error('Bounded document inventory limit reached');
      documentsPage=data.nextPageToken;
     }while(documentsPage);
    }
    pageToken=page.nextPageToken;
   }while(pageToken);
  }
  // Firestore published hard maxima: 1 MiB document and 8 MiB total index
  // entries per document. Add 4 KiB/name+metadata. Deliberately overestimates
  // these six small coordination/pointer documents; this is not a billing gauge.
  report.documentAndIndexUpperBoundBytes=report.documents.length*(9*1024**2+4096);
  report.capacityBoundSource='https://firebase.google.com/docs/firestore/quotas';
  report.inventoryComplete=true;
  const fieldsQuery=new URLSearchParams({filter:'indexConfig.usesAncestorConfig:false OR ttlConfig:*'});
  report.fields=await call(`${database}/collectionGroups/-/fields?${fieldsQuery}`);
  if(report.fields.nextPageToken)throw new Error('Incomplete field/TTL inventory');
 }catch(e){report.errors.push(e.message);if(!report.inventoryComplete)delete report.documentAndIndexUpperBoundBytes;}
 for(const prefix of ['firestore.googleapis.com/','serviceruntime.googleapis.com/api/']){
  try{
   const q=new URLSearchParams({filter:`metric.type = starts_with("${prefix}")`,pageSize:'1000'});
   const data=await call(`https://monitoring.googleapis.com/v3/${root}/metricDescriptors?${q}`);
   if(data.nextPageToken)throw new Error('Incomplete descriptor inventory');
   report.descriptors.push(...(data.metricDescriptors??[]).filter(d=>/bytes|size|ops_count|request_count/.test(d.type)).map(d=>({type:d.type,kind:d.metricKind,unit:d.unit,description:d.description,labels:d.labels})));
  }catch(e){report.errors.push(e.message);}
 }
 fs.writeFileSync('.local/trial-capacity.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({at:report.at,apiCalls:report.apiCalls,documentListPages:report.documentListPages,collections:report.collections,documentCount:report.documents.length,documentAndIndexUpperBoundBytes:report.documentAndIndexUpperBoundBytes,ttlFields:report.fields?.fields?.filter(f=>f.ttlConfig),errors:report.errors},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
