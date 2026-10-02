// Explicitly scoped to the user's NEW collector project. Never links billing,
// changes the existing Firebase site, or creates/downloads service-account keys.
const auth = require('firebase-tools/lib/auth');
const project = 'bazaarsignal-510305';
const accountEmail = 'drewstake3@gmail.com';
const region = 'us-central1';
const apply = process.argv.includes('--apply');

async function main() {
  const account = auth.getAllAccounts().find(a => a.user.email === accountEmail);
  if (!account) throw new Error(`Run firebase login:add ${accountEmail} --interactive first.`);
  let token;
  async function call(url, method = 'GET', body, allowMissing = false) {
    token = await auth.getAccessToken(account.tokens.refresh_token, []);
    const r = await fetch(url, {
      method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (allowMissing && r.status === 404) return null;
    const data = await r.json();
    if (!r.ok) throw new Error(`${method} ${new URL(url).pathname}: ${data.error?.message ?? r.status}`);
    return data;
  }
  async function operation(origin, op) {
    for (let i = 0; !op.done && i < 180; i++) {
      await new Promise(r => setTimeout(r, 1000));
      op = await call(`${origin}/${op.name}`);
    }
    if (op.error) throw new Error(op.error.message);
    if (!op.done) throw new Error('Cloud operation still pending; rerun after it finishes.');
    return op.response;
  }
  const p = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
  const billing = await call(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
  console.log(JSON.stringify({project, projectNumber:p.projectNumber, billingEnabled:billing.billingEnabled, apply}));
  if (!apply) return;
  throw new Error('Resource creation refused by the $0 policy. See docs/ZERO-COST-AUDIT.md. Do not re-enable billing or deploy the Google collector.');
  if (!billing.billingEnabled) throw new Error('Link an active billing account in Google Cloud first. No resources changed.');
  const services = [
    'firebase.googleapis.com','firestore.googleapis.com','storage.googleapis.com',
    'cloudfunctions.googleapis.com','run.googleapis.com','cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com','cloudscheduler.googleapis.com',
    'iam.googleapis.com','logging.googleapis.com','eventarc.googleapis.com','pubsub.googleapis.com',
  ];
  await operation('https://serviceusage.googleapis.com/v1', await call(
    `https://serviceusage.googleapis.com/v1/projects/${p.projectNumber}/services:batchEnable`, 'POST', {serviceIds:services}));
  const firebaseProject = await call(`https://firebase.googleapis.com/v1beta1/projects/${project}`, 'GET', undefined, true);
  if (!firebaseProject) await operation('https://firebase.googleapis.com/v1beta1', await call(
    `https://firebase.googleapis.com/v1beta1/projects/${project}:addFirebase`, 'POST', {}));
  const databases = await call(`https://firestore.googleapis.com/v1/projects/${project}/databases`);
  if (!databases.databases?.some(d=>d.name.endsWith('/(default)'))) {
    await operation('https://firestore.googleapis.com/v1', await call(
      `https://firestore.googleapis.com/v1/projects/${project}/databases?databaseId=(default)`, 'POST',
      {locationId:region,type:'FIRESTORE_NATIVE',deleteProtectionState:'DELETE_PROTECTION_ENABLED'}));
  }
  const bucket = `${project}-market-cache`;
  const existingBucket = await call(`https://storage.googleapis.com/storage/v1/b/${bucket}`, 'GET', undefined, true);
  if (!existingBucket) await call(`https://storage.googleapis.com/storage/v1/b?project=${project}`, 'POST', {
    name:bucket, location:region, storageClass:'STANDARD',
    iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},
    softDeletePolicy:{retentionDurationSeconds:'0'}, versioning:{enabled:false},
  });
  for (const id of ['market-reader','market-collector']) {
    const email=`${id}@${project}.iam.gserviceaccount.com`;
    if (!await call(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}`,'GET',undefined,true))
      await call(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`,'POST',
        {accountId:id,serviceAccount:{displayName:`BazaarSignal ${id}`}});
  }
  function grant(policy, role, members) {
    policy.bindings??=[];
    let binding=policy.bindings.find(b=>b.role===role&&!b.condition);
    if(!binding){binding={role,members:[]};policy.bindings.push(binding);}
    for(const member of members)if(!binding.members.includes(member))binding.members.push(member);
  }
  const member=id=>`serviceAccount:${id}@${project}.iam.gserviceaccount.com`;
  const policyUrl=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
  const policy=await call(`${policyUrl}:getIamPolicy`,'POST',{});
  grant(policy,'roles/datastore.user',[member('market-reader'),member('market-collector')]);
  await call(`${policyUrl}:setIamPolicy`,'POST',{policy});
  const bucketPolicy=await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`);
  grant(bucketPolicy,'roles/storage.objectViewer',[member('market-reader')]);
  grant(bucketPolicy,'roles/storage.objectAdmin',[member('market-collector')]);
  await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`,'PUT',bucketPolicy);
  console.log('Collector project prepared. Private storage and service identities configured; no function, website, or email deployment performed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
