import { describe,it,expect,vi,beforeEach } from 'vitest';
// Explicitly enabled historical delivery fixture; actual release defaults off.
vi.mock('../shared/automation-policy',()=>({BACKGROUND_JOBS_ENABLED:true,EMAIL_DELIVERY_ENABLED:true}));
import { createHash,createHmac } from 'node:crypto';
import { doGet,doPost,scheduledPoll,scheduledMinuteTick } from '../apps-script/backend';
import { emptyState,createAlert,parseMarket } from '../apps-script/core';
import { normalizeBazaar } from '../shared/companion/bazaar';
import { ADMIN_UID,DOCUMENT,checkAdmission,loadControl } from '../apps-script/store';
const origin='https://bazaarsignal.web.app',email='drew@theinnovativeowl.com';
let docs:Map<string,any>,locked=false,writes=0,sends=0,authCalls=0,claims:any,remaining=100,failCommit=false;
let deliveries:any[],properties:Record<string,string>;
const token=()=>`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const req=(body:any)=>({postData:{type:'text/plain',contents:JSON.stringify({version:1,origin,...body})}});
const input={requestId:'12345678-1234-4234-8234-123456789012',itemId:'SUMMONING_EYE',side:'buy',quantity:1,target:100,taxRate:1.25};
const raw=()=>({success:true,lastUpdated:Date.now(),products:{SUMMONING_EYE:{buy_summary:[{amount:100,orders:1,pricePerUnit:100}],sell_summary:[{amount:100,orders:1,pricePerUnit:90}]}}});
const stored=(path:string)=>JSON.parse(docs.get(path).fields.json.stringValue);
const put=(path:string,value:any,fields:any={})=>docs.set(path,{name:`${DOCUMENT}/${path}`,fields:{json:{stringValue:JSON.stringify(value)},...fields},updateTime:`v${++writes}`});
const capability=(uid:string,id=input.requestId)=>createHmac('sha256','a'.repeat(64)).update(`disable:v1:${uid}:${id}`).digest('hex');
const blob=(x:any)=>({getBytes:()=>Buffer.from(x),getDataAsString:()=>Buffer.from(x).toString()});
function asUser(uid:string,mail:string){claims={...claims,sub:uid,email:mail};}
beforeEach(()=>{
  docs=new Map();locked=false;writes=0;sends=0;authCalls=0;remaining=100;failCommit=false;deliveries=[];
  const now=Date.now();claims={sub:ADMIN_UID,email,email_verified:true,aud:'bazaarsignal',iss:'https://securetoken.google.com/bazaarsignal',exp:now/1000+3600,iat:now/1000,auth_time:now/1000,firebase:{sign_in_provider:'google.com'}};
  properties={FIREBASE_API_KEY:'public-key',TOKEN_KEY:'a'.repeat(64),APP_URL:origin,MARKET_API_URL:'https://market.example.com',MARKET_UPDATES_PAUSED:'false'};
  properties.MARKET_TRIAL_START=new Date(now-1000).toISOString();
  properties.MARKET_TRIAL_END=new Date(now+14*60_000).toISOString();
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperties:()=>properties,getProperty:(k:string)=>properties[k],setProperty:(k:string,v:string)=>properties[k]=v,deleteProperty:(k:string)=>delete properties[k]})});
  vi.stubGlobal('Session',{getEffectiveUser:()=>({getEmail:()=> 'bazaarsignal@gmail.com'})});
  vi.stubGlobal('ScriptApp',{getOAuthToken:()=> 'server-only-access-token',getProjectTriggers:()=>[{getHandlerFunction:()=> 'scheduledPoll'}]});
  vi.stubGlobal('ContentService',{MimeType:{JSON:'json'},createTextOutput:(s:string)=>({setMimeType:()=>JSON.parse(s)})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true},releaseLock:()=>locked=false})});
  const cache=new Map();vi.stubGlobal('CacheService',{getScriptCache:()=>({get:(k:string)=>cache.get(k),put:(k:string,v:string)=>cache.set(k,v),remove:(k:string)=>cache.delete(k),putAll:(v:any)=>Object.entries(v).forEach(([k,x])=>cache.set(k,x))})});
  vi.stubGlobal('Utilities',{newBlob:blob,gzip:(b:any)=>b,ungzip:(b:any)=>b,base64Encode:(b:any)=>Buffer.from(b).toString('base64'),base64Decode:(s:string)=>Buffer.from(s,'base64'),base64DecodeWebSafe:(s:string)=>Buffer.from(s,'base64url'),
    Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_:any,s:string)=>Array.from(createHash('sha256').update(s).digest()),
    computeHmacSha256Signature:(s:string,key:string)=>Array.from(createHmac('sha256',key).update(s).digest())});
  vi.stubGlobal('MailApp',{getRemainingDailyQuota:()=>remaining,sendEmail:(mail:any)=>{sends++;remaining--;deliveries.push(mail);}});
  vi.stubGlobal('UrlFetchApp',{fetch:(url:string,options:any)=>{
    let body:any,code=200;
    if(url.includes('accounts:lookup')){authCalls++;body={users:[{localId:claims.sub,email:claims.email,emailVerified:true,providerUserInfo:[{providerId:'google.com'}]}]};}
    else if(url.endsWith(':commit')){
      const batch=JSON.parse(options.payload).writes;
      if(failCommit || batch.some((w:any)=>{const old=docs.get(w.update.name.split('/documents/')[1]);return w.currentDocument?.exists===false?Boolean(old):w.currentDocument?.updateTime && old?.updateTime!==w.currentDocument.updateTime;})){code=409;body={};}
      else {const results=batch.map((w:any)=>{const stamp='v'+(++writes);docs.set(w.update.name.split('/documents/')[1],{...w.update,updateTime:stamp});return {updateTime:stamp};});body={writeResults:results};}
    } else if(url.endsWith(':runQuery')){
      const query=JSON.parse(options.payload).structuredQuery,cursor=query.startAt?.values[0].referenceValue || '';
      body=[...docs.values()].filter(d=>d.name?.startsWith(`${DOCUMENT}/backendUsers/`) && d.fields.active?.booleanValue && d.name>cursor).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,query.limit).map(document=>({document}));
    } else if(url.includes('/documents/')) {body=docs.get(url.split('/documents/')[1]);if(!body){code=404;body={};}}
    else if(url.endsWith('/raw-bazaar'))body={...raw(),names:{}};
    else if(url.endsWith('/bazaar'))body={items:[{...normalizeBazaar('SUMMONING_EYE',raw().products.SUMMONING_EYE,Date.now(),Date.now()),feeContext:{mayor:'Unknown',multiplier:null,checkedAt:Date.now(),explanation:'Unknown'}}],error:null};
    else throw new Error('Unexpected URL');
    return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)};
  }});
});
function seedLegacy(uid=ADMIN_UID,recipient=email) {
  const state=emptyState(uid),hash=createHash('sha256').update(capability(uid)).digest('hex');
  createAlert(state,input,parseMarket(raw(),Date.now()),recipient,hash,Date.now());
  put(`backendUsers/${uid}`,state,{active:{booleanValue:true}});
  docs.set(`alertLinks/${hash}`,{fields:{uid:{stringValue:uid},alertId:{stringValue:input.requestId}}});
}
describe('portfolio-release HTTP boundaries and legacy preservation',()=>{
  it('idle paused workers perform no repeated network reads, writes or sends',()=>{
    seedLegacy();const state=stored(`backendUsers/${ADMIN_UID}`);state.mail[0].status='sent';put(`backendUsers/${ADMIN_UID}`,state,{active:{booleanValue:true}});
    const fetcher=vi.spyOn((globalThis as any).UrlFetchApp,'fetch');
    expect(scheduledPoll().ok).toBe(true);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts).toEqual(state.alerts);
    expect(docs.get(`backendUsers/${ADMIN_UID}`).fields.active.booleanValue).toBe(false);
    expect(scheduledPoll()).toMatchObject({ok:true,idle:true});
    const before=writes;fetcher.mockClear();
    for(let i=0;i<11;i++)expect(scheduledPoll()).toMatchObject({ok:true,idle:true});
    expect(fetcher).not.toHaveBeenCalled();expect(writes).toBe(before);expect(sends).toBe(0);
  });
  it('ignores former live properties and rejects obsolete public operations without market requests',()=>{
    const fetcher=vi.spyOn((globalThis as any).UrlFetchApp,'fetch');
    for(const action of ['snapshot','book','companion','playerNames'])expect(doPost(req({action})).error).toMatch(/Unsupported/);
    scheduledPoll();expect(fetcher.mock.calls.some(([url])=>String(url).includes('market.example.com'))).toBe(false);
  });
  it('rejects new standalone targets without writes or mail, while allowing idempotent old retries',()=>{
    expect(doPost(req({action:'create',input,idToken:token()})).error).toContain('portfolio holding');expect(writes).toBe(0);expect(sends).toBe(0);
    seedLegacy();const before=writes;expect(doPost(req({action:'create',input,idToken:token()})).ok).toBe(true);expect(writes).toBe(before);
    expect(doPost(req({action:'create',input:{...input,target:90},idToken:token()})).ok).toBe(false);
  });
  it('requires verified Google identity for all private operations and rejects forged ownership',()=>{
    seedLegacy();
    for(const action of ['account','create','update','portfolio-notification','legacy-pause'])expect(doPost(req({action,input,id:input.requestId,uid:ADMIN_UID,email})).ok).toBe(false);
    asUser('other','other@example.test');expect(doPost(req({action:'account',idToken:token(),uid:ADMIN_UID})).data.workflows).toEqual([]);
    expect(doPost(req({action:'legacy-pause',id:input.requestId,idToken:token(),uid:ADMIN_UID})).ok).toBe(false);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.paused).toBe(false);
  });
  it('pauses only the verified owner legacy record and cancels unsent work',()=>{
    seedLegacy();const result=doPost(req({action:'legacy-pause',id:input.requestId,idToken:token()}));expect(result.ok).toBe(true);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.paused).toBe(true);expect(stored(`backendUsers/${ADMIN_UID}`).mail[0].status).toBe('cancelled');expect(sends).toBe(0);
  });
  it('retains disable capabilities, explicit confirmation and harmless GET behavior',()=>{
    seedLegacy();const before=writes;expect(doGet().ok).toBe(false);expect(writes).toBe(before);
    expect(doPost(req({action:'disable',token:capability(ADMIN_UID)})).ok).toBe(false);
    for(let i=0;i<2;i++)expect(doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true})).ok).toBe(true);
    expect(sends).toBe(0);
  });
  it('preserves the original legacy owner document during backend migration',()=>{
    const state=emptyState(ADMIN_UID),hash=createHash('sha256').update(capability(ADMIN_UID)).digest('hex');
    createAlert(state,input,parseMarket(raw(),Date.now()),email,hash,Date.now());put('backend/state',state);
    expect(doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true})).ok).toBe(true);
    expect(stored('backend/state').alerts[0].workflow.paused).toBe(false);expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].tokenHash).toBe(hash);
  });
  it('keeps queued legacy delivery and target edits available during the market pause without market requests',()=>{
    seedLegacy();delete properties.MARKET_UPDATES_PAUSED;const fetcher=vi.spyOn((globalThis as any).UrlFetchApp,'fetch');
    expect(doPost(req({action:'update',id:input.requestId,target:90,revision:0,idToken:token()})).ok).toBe(true);
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(1);expect(fetcher.mock.calls.some(([url])=>String(url).includes('market.example.com'))).toBe(false);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.stage).not.toBe('completed');
  });
  it('shares delivery quotas across accounts and never resends accepted messages',()=>{
    seedLegacy();seedLegacy('other','other@example.test');remaining=1;delete properties.MARKET_UPDATES_PAUSED;
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(1);expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(1);
    const mail=[...stored(`backendUsers/${ADMIN_UID}`).mail,...stored('backendUsers/other').mail];expect(mail.filter(m=>m.status==='sent')).toHaveLength(1);expect(mail.filter(m=>m.status==='queued').every(m=>m.attempts===0)).toBe(true);
  });
  it('rejects hostile origins, JSON preflight, overlapping jobs and editor-only operations',()=>{
    expect(doPost(req({action:'account',origin:'https://evil.test',idToken:token()})).ok).toBe(false);
    const r=req({action:'account'});r.postData.type='application/json';expect(doPost(r).ok).toBe(false);
    expect(doPost(req({action:'sendTestConfirmation',idToken:token()})).ok).toBe(false);locked=true;expect(scheduledPoll().ok).toBe(false);expect(sends).toBe(0);expect(writes).toBe(0);
  });
});
