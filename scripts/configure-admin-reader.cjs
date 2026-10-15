// Existing Apps Script sender: single-document operational reads only, expiring
// with the paid pilot. No list/query, writes, billing, scheduler, or Auth access.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
  const apply=process.argv.includes('--apply'),project='bazaarsignal-510305';
  const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');if(!a)throw Error('Owner login missing');
  const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
  const request=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok&&r.status!==404)throw Error(`Admin reader HTTP ${r.status}`);return {status:r.status,data};};
  const name=`projects/${project}/roles/bazaarPilotStatusReader`,member='user:bazaarsignal@gmail.com';
  const role=await request(`https://iam.googleapis.com/v1/${name}`);
  if(role.status!==404 && JSON.stringify(role.data.includedPermissions)!==JSON.stringify(['datastore.entities.get']))throw Error('Unexpected existing role; refusing overwrite');
  const url=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
  const policy=(await request(`${url}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}})).data;
  const condition={title:'October paid pilot Admin reads',expression:"request.time < timestamp('2026-11-01T07:00:00Z')"};
  const exists=policy.bindings?.some(b=>b.role===name&&b.members?.includes(member)&&b.condition?.expression===condition.expression);
  const file=`.local/admin-reader-${Date.now()}.json`;fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),apply,role:name,member,condition,before:policy},null,2),{flag:'wx'});
  if(apply&&!exists){
    if(role.status===404)await request(`https://iam.googleapis.com/v1/projects/${project}/roles`,'POST',{roleId:'bazaarPilotStatusReader',role:{title:'Paid pilot status reader',description:'Existing sender reads operational documents for the verified-owner Admin dashboard.',stage:'GA',includedPermissions:['datastore.entities.get']}});
    if(!policy.etag)throw Error('Missing policy concurrency token');policy.version=3;policy.bindings??=[];policy.bindings.push({role:name,members:[member],condition});
    await request(`${url}:setIamPolicy`,'POST',{policy});
    const after=(await request(`${url}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}})).data;
    if(!after.bindings?.some(b=>b.role===name&&b.members?.includes(member)&&b.condition?.expression===condition.expression))throw Error('Grant verification failed');
  }
  console.log(JSON.stringify({applied:apply,alreadyPresent:!!exists,permission:'datastore.entities.get',expiresAt:'2026-11-01T07:00:00Z',receipt:file}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
