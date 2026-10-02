const fs=require('node:fs'),crypto=require('node:crypto'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const label=process.argv[2];if(!['baseline','before','after'].includes(label))throw new Error('Use baseline, before or after');
 const prefix=process.argv[3]??'usage';if(!/^usage(?:-[a-z-]+)?$/.test(prefix))throw new Error('Invalid receipt prefix');
 const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
 const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
 const root='https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/';
 const read=async(key)=>{const r=await fetch(root+key,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();};
 const [cache,ledger]=await Promise.all([read('usage-dashboard'),read('live-allowance')]);
 const data=JSON.parse(cache.fields.value.stringValue),state=JSON.parse(ledger.fields.value.stringValue);
 const receipt={at:new Date().toISOString(),cacheUpdateTime:cache.updateTime,generatedAt:data.snapshot.generatedAt,nextAttemptAt:data.nextAttemptAt,
   cacheHash:crypto.createHash('sha256').update(cache.fields.value.stringValue).digest('hex'),hypixelRequests:state.observed.hypixelRequests,
   ledgerHash:crypto.createHash('sha256').update(ledger.fields.value.stringValue).digest('hex'),rowCount:data.snapshot.rows.length,
   measured:data.snapshot.rows.filter(r=>r.state==='measured').length,notReported:data.snapshot.rows.filter(r=>r.state==='not-reported').map(r=>r.id),unavailable:data.snapshot.rows.filter(r=>r.state==='unavailable').map(r=>r.id),
   imageBytes:data.snapshot.rows.find(r=>r.id==='images')?.measured,
   coverage:data.snapshot.rows.filter(r=>r.state!=='measured').map(r=>({id:r.id,reason:r.coverage})),
   connected:data.snapshot.rows.filter(r=>['script-mail','script-runtime','builds'].includes(r.id)).map(r=>({id:r.id,measured:r.measured,reservation:r.reservation,measuredAt:r.measuredAt}))};
 fs.writeFileSync(`.local/${prefix}-cache-${label}.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
