// Read-only capability discovery. Never prints credentials or enables an API.
const fs = require('node:fs');
const auth = require('firebase-tools/lib/auth');
(async () => {
  const a = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!a) throw new Error('Deployment account unavailable');
  const {access_token} = await auth.getAccessToken(a.tokens.refresh_token, []);
  const out = {at:new Date().toISOString(), projects:{}};
  async function read(url, body) {
    const r = await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    const d=await r.json(); return r.ok?d:{status:r.status,error:d.error?.message};
  }
  for (const p of ['bazaarsignal','bazaarsignal-510305']) {
    const data = out.projects[p] = {};
    data.billing = await read(`https://cloudbilling.googleapis.com/v1/projects/${p}/billingInfo`);
    data.datasets = await read(`https://bigquery.googleapis.com/bigquery/v2/projects/${p}/datasets?all=true&maxResults=100`);
    data.permissions = await read(`https://cloudresourcemanager.googleapis.com/v1/projects/${p}:testIamPermissions`,{permissions:['monitoring.timeSeries.list','resourcemanager.projects.setIamPolicy','bigquery.datasets.get','bigquery.tables.getData']});
    data.metrics = {};
    for (const prefix of ['firebasehosting.googleapis.com/','identitytoolkit.googleapis.com/','cloudbuild.googleapis.com/','artifactregistry.googleapis.com/','firestore.googleapis.com/storage/']) {
      const q = new URLSearchParams({filter:`metric.type = starts_with("${prefix}")`,pageSize:'100'});
      const d = await read(`https://monitoring.googleapis.com/v3/projects/${p}/metricDescriptors?${q}`);
      data.metrics[prefix] = d.error ? d : (d.metricDescriptors??[]).map(x=>({type:x.type,kind:x.metricKind,unit:x.unit,description:x.description}));
    }
  }
  fs.writeFileSync('.local/usage-source-inspection.json',JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
