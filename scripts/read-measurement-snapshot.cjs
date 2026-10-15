// Two bounded document reads. Save measurements, never create user activity.
const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib'),auth=require('firebase-tools/lib/auth');
const output=process.argv[2];
if(!/^\.local\/measurement-evidence-[a-z0-9-]+\.json$/.test(output??''))throw Error('New evidence receipt required');
const r={at:new Date().toISOString(),calls:0,maxCalls:2,reservations:{firestoreReads:4,logBytes:1048576,responseBytes:1310720},responseBytes:0,resources:{},errors:[]};
fs.writeFileSync(output,JSON.stringify(r),{flag:'wx'});const save=()=>fs.writeFileSync(output,JSON.stringify(r,null,2));
(async()=>{const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');if(!a)throw Error('Existing login required');
 const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
 for(const key of ['control','bazaar']) {
  r.calls++;save();const limit=key==='control'?131072:1179648;
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/${key}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  const parts=[];let size=0;for await(const c of response.body){size+=c.length;if(size>limit)throw Error('Response bound');parts.push(c);}
  const d=JSON.parse(Buffer.concat(parts).toString());if(!response.ok)throw Error(`HTTP ${response.status}`);r.responseBytes+=size;
  if(key==='control')r.resources.control=d;
  else {
   const raw=d.fields?.value?.stringValue,match=/^market-br-v1:([a-f0-9]{64}):([A-Za-z0-9+/]+={0,2})$/.exec(raw??'');
   if(!match)throw Error('Expected bounded inline snapshot');
   const bytes=Buffer.from(match[2],'base64');if(crypto.createHash('sha256').update(bytes).digest('hex')!==match[1])throw Error('Snapshot checksum');
   const s=JSON.parse(zlib.brotliDecompressSync(bytes,{maxOutputLength:12*1024**2}).toString());
   r.resources.snapshot={updateTime:d.updateTime,encodedBytes:Buffer.byteLength(raw),compressedBytes:bytes.length,sha256:match[1],version:s.version,observedAt:s.observedAt,upstreamAt:s.upstreamAt,products:s.data.items.length};
  }
  save();
 }
 const c=JSON.parse(r.resources.control.fields.value.stringValue);r.summary={lease:c.lease,maxRetries:c.policy.maxRetries,totalRequests:c.totalRequests,bazaar:c.jobs.bazaar,auctions:c.jobs.auctions,snapshot:r.resources.snapshot};
 r.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,calls:r.calls,summary:r.summary,errors:r.errors},null,2));
})().catch(e=>{r.errors.push(e.message);save();console.error(e.message);process.exitCode=1;});
