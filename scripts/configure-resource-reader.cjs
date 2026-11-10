// Reporting-only IAM for the existing sender. Preserves other policy bindings
// with an etag; no service activation, collection, billing, or runtime changes.
const fs = require('node:fs'), auth = require('firebase-tools/lib/auth');
(async()=>{
  const apply=process.argv.includes('--apply');
  const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw Error('Owner login unavailable');
  const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  const call=async(url,method='GET',body)=>{
    const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok&&r.status!==404)throw Error(`Reporting IAM HTTP ${r.status}`);return {status:r.status,data};
  };
  const member='user:bazaarsignal@gmail.com',report={at:new Date().toISOString(),apply,projects:[]};
  for(const project of ['bazaarsignal','bazaarsignal-510305']){
    const permissions=['monitoring.timeSeries.list','serviceusage.services.use',...(project==='bazaarsignal'?['firebaseauth.users.get']:['run.services.get','cloudscheduler.jobs.get','cloudscheduler.jobs.list','cloudbuild.builds.list','artifactregistry.repositories.get'])].sort();
    const role=`projects/${project}/roles/bazaarResourceReporter`,root=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
    const existing=await call(`https://iam.googleapis.com/v1/${role}`);
    if(existing.status!==404&&existing.data.includedPermissions.some(p=>!permissions.includes(p)))throw Error('Unexpected existing reporting role');
    const policy=(await call(`${root}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}})).data;
    if(!policy.etag)throw Error('Missing IAM concurrency token');
    const granted=policy.bindings?.some(b=>b.role===role&&!b.condition&&b.members?.includes(member));
    report.projects.push({project,role,member,permissions,granted,before:policy});
    fs.writeFileSync(`.local/resource-reader-${apply?'apply':'inspect'}.json`,JSON.stringify(report,null,2));
    if(apply){
      if(existing.status===404)await call(`https://iam.googleapis.com/v1/projects/${project}/roles`,'POST',{roleId:'bazaarResourceReporter',role:{title:'BazaarSignal reporting reader',description:'Read usage counters and operational configuration for daily owner reports.',stage:'GA',includedPermissions:permissions}});
      else if(permissions.some(p=>!existing.data.includedPermissions.includes(p)))await call(`https://iam.googleapis.com/v1/${role}?updateMask=includedPermissions`,'PATCH',{...existing.data,includedPermissions:permissions});
      if(!granted){policy.bindings??=[];policy.bindings.push({role,members:[member]});await call(`${root}:setIamPolicy`,'POST',{policy});}
      const after=(await call(`${root}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}})).data;
      if(!after.bindings?.some(b=>b.role===role&&!b.condition&&b.members?.includes(member)))throw Error('Reporting access verification failed');
    }
  }
  console.log(JSON.stringify({apply,projects:report.projects.map(({before,...p})=>p)},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
