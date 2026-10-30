// Fixed-scope management transport. Defaults to read-only; never calls app URLs.
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {CLOUD_ROOT} from './ledger-v2-migration.mjs';
export const PROJECT='bazaarsignal-510305';
export const SCRIPT='1CXTzdNawDAnKq1vKzw5_CZJIKc3JROPCrucDRMi9XNb4XSeYncS9DlW4';
export const DEPLOYMENT='AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q';
export const DB=`projects/${PROJECT}/databases/(default)/documents`;
export const REGISTRY='https://us-central1-docker.pkg.dev';
export const REPOSITORY=`${PROJECT}/gcf-artifacts/market-trial`;
const methods=new Set(['GET','HEAD','POST','PUT','PATCH']);
export function classifyRequest(url,method='GET',body) {
  const u=new URL(url),p=decodeURIComponent(u.pathname);
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!methods.has(method))throw Error('Untrusted management request');
  let allowed=false,read=['GET','HEAD'].includes(method);
  switch(u.hostname) {
    case 'run.googleapis.com':
      allowed=new RegExp(`^/v[12]/${CLOUD_ROOT}/(services/(marketapi|refreshmarket)(/revisions/[a-z0-9-]+|:(getIamPolicy|setIamPolicy))?|operations/[a-zA-Z0-9_-]+)$`).test(p);break;
    case 'cloudscheduler.googleapis.com':
      allowed=new RegExp(`^/v1/${CLOUD_ROOT}/jobs(/(firebase-schedule-refreshMarket-us-central1|bazaar-daily-close)(:(pause|resume))?)?$`).test(p);break;
    case 'firestore.googleapis.com':
      allowed=p===`/v1/${DB}:commit` || p===`/v1/${DB}:runQuery` ||
        [`/v1/${DB}/marketCache/paid-budget-october`,`/v1/${DB}/marketCache/live-allowance`,`/v1/${DB}/marketCache/control`].includes(p);
      if(p.endsWith(':runQuery')&&method==='POST') {
        const q=body?.structuredQuery;
        read=q?.from?.length===1&&q.from[0].collectionId==='marketCache'&&!q.from[0].allDescendants&&q.limit<=4001&&q.limit>0;
        const filters=q?.where?.compositeFilter?.filters;
        read=read&&q.where.compositeFilter.op==='AND'&&filters?.length===2&&
          filters.every(f=>f.fieldFilter?.field?.fieldPath==='__name__')&&
          filters[0].fieldFilter.op==='GREATER_THAN_OR_EQUAL'&&filters[0].fieldFilter.value?.referenceValue===`${DB}/marketCache/paid-receipt-`&&
          filters[1].fieldFilter.op==='LESS_THAN'&&filters[1].fieldFilter.value?.referenceValue===`${DB}/marketCache/paid-receipt.`;
        if(!read)throw Error('Unbounded or unrelated Firestore query');
      }
      break;
    case 'cloudresourcemanager.googleapis.com':
      allowed=[`/v1/projects/${PROJECT}`,`/v1/projects/${PROJECT}:getIamPolicy`].includes(p);
      if(p.endsWith(':getIamPolicy')&&method==='POST')read=true;break;
    case 'artifactregistry.googleapis.com':allowed=p.startsWith(`/v1/${CLOUD_ROOT}/repositories/gcf-artifacts`);break;
    case 'cloudbilling.googleapis.com':allowed=p===`/v1/projects/${PROJECT}/billingInfo`;break;
    case 'script.googleapis.com':
      allowed=p===`/v1/projects/${SCRIPT}`||p===`/v1/projects/${SCRIPT}/content`||
        new RegExp(`^/v1/projects/${SCRIPT}/(deployments(/${DEPLOYMENT})?|versions(/[0-9]+)?)$`).test(p)||
        (p==='/v1/processes:listScriptProcesses'&&u.searchParams.get('scriptId')===SCRIPT);break;
    case 'firebasehosting.googleapis.com':allowed=/^\/v1beta1\/sites\/bazaarsignal\/(releases|versions)(\/[a-zA-Z0-9_-]+)?(\/files|:populateFiles)?$/.test(p);break;
    case 'upload-firebasehosting.googleapis.com':allowed=/^\/upload\/sites\/bazaarsignal\/versions\/[a-zA-Z0-9_-]+\/files\/[a-f0-9]{64}$/.test(p);break;
    case 'us-central1-docker.pkg.dev':allowed=p.startsWith(`/v2/${REPOSITORY}/`)||/^\/artifacts-uploads\/namespaces\/bazaarsignal-510305\/repositories\/gcf-artifacts\/uploads\/[a-zA-Z0-9_-]+$/.test(p)||
      (method==='GET'&&!u.search&&/^\/artifacts-downloads\/namespaces\/bazaarsignal-510305\/repositories\/gcf-artifacts\/downloads\/[a-zA-Z0-9_-]+$/.test(p));break;
  }
  if(!allowed||/:run$|:runJob$|:cancel$|:delete$/.test(p))throw Error('Untrusted management target');
  // No mutation API is ever classified as read-only, even if given GET.
  if(/:(commit|pause|resume|setIamPolicy|populateFiles)$/.test(p)||p.includes('/uploads/')||u.hostname==='upload-firebasehosting.googleapis.com')read=false;
  if(!read&&['GET','HEAD'].includes(method))throw Error('Invalid mutation method');
  return {read,scope:u.hostname==='script.googleapis.com'?'script':'cloud',url:u};
}
export class GoogleManagementHttp {
  constructor({token,fetchImpl=fetch,authorize=()=>false,save=async()=>{},journal={calls:0,responseBytes:0,requests:[]},maxCalls=1500,maxResponseBytes=64*1024**2,now=Date.now}={}) {
    Object.assign(this,{token,fetchImpl,authorize,save,journal,maxCalls,maxResponseBytes,now});
    if(!Number.isSafeInteger(journal.calls)||journal.calls<0||!Number.isSafeInteger(journal.responseBytes)||journal.responseBytes<0)throw Error('Invalid HTTP journal');
  }
  async request(url,{method='GET',body,limit=3*1024**2,contentType='application/json',allowed=[]}={}) {
    const classification=classifyRequest(url,method,body);
    if(!classification.read&&!this.authorize())throw Error('Production mutation is not authorized');
    if(++this.journal.calls>this.maxCalls)throw Error('HTTP call budget exhausted');
    const entry={at:this.now(),method,host:classification.url.hostname,path:classification.url.pathname,readOnly:classification.read,status:'intent'};
    this.journal.requests.push(entry);await this.save(this.journal);
    let response;
    try {
      const credential=await this.token(classification.scope);
      const registryBlob=method==='GET'&&classification.url.origin===REGISTRY&&
        classification.url.pathname.startsWith(`/v2/${REPOSITORY}/blobs/sha256:`);
      response=await this.fetchImpl(url,{method,redirect:registryBlob?'manual':'error',signal:AbortSignal.timeout(30000),
        headers:{Authorization:`Bearer ${credential}`,'Content-Type':contentType},
        ...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
      if(registryBlob&&[302,307].includes(response.status)) {
        const destination=new URL(response.headers.get('location')??'',url);
        await response.body?.cancel();entry.status=response.status;entry.bytes=0;await this.save(this.journal);
        if(destination.origin!==REGISTRY||destination.search||destination.hash||destination.username||destination.password||
            !/^\/artifacts-downloads\/namespaces\/bazaarsignal-510305\/repositories\/gcf-artifacts\/downloads\/[a-zA-Z0-9_-]+$/.test(destination.pathname))
          throw Error('Untrusted registry download redirect');
        // One exact same-host, same-repository GET; its response keeps the
        // original byte bound and cannot redirect again or replay any write.
        return await this.request(destination.href,{method:'GET',limit,contentType});
      }
      const chunks=[];let size=0;
      for await(const chunk of response.body??[]) {
        size+=chunk.length;this.journal.responseBytes+=chunk.length;
        if(size>limit||this.journal.responseBytes>this.maxResponseBytes)throw Error('Management response bound exceeded');
        chunks.push(chunk);
      }
      entry.status=response.status;entry.bytes=size;await this.save(this.journal);
      if(!response.ok&&!allowed.includes(response.status))throw Object.assign(Error(`Management HTTP ${response.status} at ${classification.url.hostname}`),{status:response.status,code:[400,401,403,404,409,412].includes(response.status)?'REJECTED':'UNCERTAIN'});
      const bytes=Buffer.concat(chunks);
      return {status:response.status,headers:response.headers,bytes,json:()=>bytes.length?JSON.parse(bytes):{}};
    } catch(error) {
      if(entry.status==='intent')entry.status='uncertain';await this.save(this.journal);
      // Never expose provider bodies, credentials, or arbitrary fetch exceptions.
      if(error.status||/bound exceeded/.test(error.message))throw error;
      throw Object.assign(Error('Management request outcome unknown; reconcile before retry'),{code:'UNCERTAIN'});
    }
  }
  async json(url,options) {return (await this.request(url,options)).json();}
}
export async function localTokens() {
  const auth=createRequire(import.meta.url)('firebase-tools/lib/auth');
  const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw Error('Expected Firebase owner login unavailable');
  let cloud,script;
  return async scope=>{
    if(scope==='cloud') {
      cloud??=await auth.getAccessToken(account.tokens.refresh_token,[]);return cloud.access_token;
    }
    if(!script) {
      // Load existing clasp credentials without login, consent, or credential-file writes.
      const {FileCredentialStore}=await import('../node_modules/@google/clasp/build/src/auth/file_credential_store.js');
      const {GoogleAuth}=createRequire(import.meta.url)('google-auth-library');
      const saved=await new FileCredentialStore(join(homedir(),'.clasprc.json')).load('default');
      if(!saved)throw Error('Existing Apps Script credentials unavailable');
      script=new GoogleAuth().fromJSON(saved);script.setCredentials(saved);
    }
    const result=await script.getAccessToken();if(!result.token)throw Error('Apps Script access token unavailable');return result.token;
  };
}
