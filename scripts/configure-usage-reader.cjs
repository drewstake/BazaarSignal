// Narrow read-only IAM grants for the existing API runtime. No billing, service,
// schedule, user-data, or collection changes. Run without --apply to inspect.
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
  const apply=process.argv.includes('--apply');
  const a=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!a)throw new Error('Deployment account unavailable');
  const token=(await auth.getAccessToken(a.tokens.refresh_token,[])).access_token;
  const member='serviceAccount:market-reader@bazaarsignal-510305.iam.gserviceaccount.com';
  const report={at:new Date().toISOString(),apply,grants:[]};
  const request=async(url,method='GET',body)=>{
    const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok&&r.status!==404)throw new Error(`${r.status}: ${data.error?.message}`);return {status:r.status,data};
  };
  for(const project of ['bazaarsignal','bazaarsignal-510305']) {
    const permissions=['monitoring.timeSeries.list',...(project==='bazaarsignal'?['firebaseauth.users.get','datastore.entities.get']:['cloudscheduler.jobs.list','cloudbuild.builds.list','artifactregistry.repositories.get'])];
    const name=`projects/${project}/roles/bazaarUsageReader`,role=await request(`https://iam.googleapis.com/v1/${name}`);
    if(role.status!==404 && role.data.includedPermissions.some(p=>!permissions.includes(p)))throw new Error('Existing usage role contains unexpected permissions; refusing to overwrite');
    const policy=(await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}})).data;
    if(!policy.etag)throw new Error('Missing IAM concurrency token');
    const exists=policy.bindings?.some(b=>b.role===name&&!b.condition&&b.members?.includes(member));
    report.grants.push({project,role:name,member,permissions,alreadyGranted:!!exists});
    if(!apply)continue;
    if(role.status===404)await request(`https://iam.googleapis.com/v1/projects/${project}/roles`,'POST',{roleId:'bazaarUsageReader',role:{title:'BazaarSignal owner usage reader',description:'Read platform counters and verify Firebase owner revocation; no mutation permissions.',stage:'GA',includedPermissions:permissions}});
    else if(permissions.some(p=>!role.data.includedPermissions.includes(p)))await request(`https://iam.googleapis.com/v1/${name}?updateMask=includedPermissions`,'PATCH',{...role.data,includedPermissions:permissions});
    if(!exists){policy.bindings??=[];policy.bindings.push({role:name,members:[member]});await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:setIamPolicy`,'POST',{policy});}
  }
  fs.writeFileSync(`.local/usage-reader-${apply?'apply':'inspect'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
