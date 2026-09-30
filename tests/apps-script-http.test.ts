import { describe,it,expect,vi,beforeEach } from 'vitest';
import { createHash,createHmac } from 'node:crypto';
import { doGet,doPost,scheduledPoll } from '../apps-script/backend';
import { emptyState,createAlert,parseMarket } from '../apps-script/core';
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
  properties={FIREBASE_API_KEY:'public-key',TOKEN_KEY:'a'.repeat(64),APP_URL:origin};
  vi.stubGlobal('PropertiesService',{getScriptProperties:()=>({getProperties:()=>properties,getProperty:(k:string)=>properties[k],setProperty:(k:string,v:string)=>properties[k]=v,deleteProperty:(k:string)=>delete properties[k]})});
  vi.stubGlobal('Session',{getEffectiveUser:()=>({getEmail:()=> 'bazaarsignal@gmail.com'})});
  vi.stubGlobal('ScriptApp',{getOAuthToken:()=> 'server-only-access-token',getProjectTriggers:()=>[{getHandlerFunction:()=> 'scheduledPoll'}]});
  vi.stubGlobal('ContentService',{MimeType:{JSON:'json'},createTextOutput:(s:string)=>({setMimeType:()=>JSON.parse(s)})});
  vi.stubGlobal('LockService',{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true},releaseLock:()=>locked=false})});
  const cache=new Map();vi.stubGlobal('CacheService',{getScriptCache:()=>({get:(k:string)=>cache.get(k),put:(k:string,v:string)=>cache.set(k,v),putAll:(v:any)=>Object.entries(v).forEach(([k,x])=>cache.set(k,x))})});
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
      body=[...docs.values()].filter(d=>d.name.startsWith(`${DOCUMENT}/backendUsers/`) && d.fields.active?.booleanValue && d.name>cursor).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,query.limit).map(document=>({document}));
    } else if(url.includes('/documents/')) {body=docs.get(url.split('/documents/')[1]);if(!body){code=404;body={};}}
    else if(url.includes('/resources/'))body={success:true,items:[]};
    else if(url.endsWith('/bazaar'))body=raw();
    else throw new Error('Unexpected URL');
    return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)};
  }});
});
describe('Public Apps Script access and isolation',()=>{
  it('serves the new public companion without leaking accounts and withholds unverified tax assumptions',()=>{
    const result=doPost(req({action:'companion',uid:ADMIN_UID,email}));
    expect(result.ok).toBe(true);expect(result.data.items[0].asks[0].pricePerUnit).toBe(100);
    expect(result.data.items[0].feeContext.multiplier).toBeNull();
    expect(JSON.stringify(result)).not.toContain(email);expect(authCalls).toBe(0);expect(sends).toBe(0);
  });
  it('allows anonymous prices and books without returning private data or validating a supplied UID',()=>{
    doPost(req({action:'create',input,idToken:token()}));
    for(const action of ['snapshot','book']){
      const result=doPost(req({action,itemId:'SUMMONING_EYE',uid:ADMIN_UID,email}));expect(result.ok).toBe(true);
      const text=JSON.stringify(result.data);expect(text).not.toContain(email);expect(text).not.toContain(input.requestId);expect(result.data.workflows).toBeUndefined();expect(result.data.events).toBeUndefined();
    }
    expect(authCalls).toBe(1);
  });
  it('requires verified Firebase Google identity for account reads and creation',()=>{
    for(const action of ['account','create','update'])expect(doPost(req({action,input,id:input.requestId,target:90,revision:0,uid:ADMIN_UID,email})).ok).toBe(false);
    claims.email_verified=false;expect(doPost(req({action:'create',input,idToken:token()})).ok).toBe(false);expect(writes).toBe(0);
  });
  it('allows another Google user while ignoring forged UID and recipient',()=>{
    asUser('personal','drewstake3@gmail.com');expect(doPost(req({action:'create',input,idToken:token(),uid:ADMIN_UID,email:'victim@example.com'})).ok).toBe(true);
    expect(stored('backendUsers/personal').ownerUid).toBe('personal');expect(stored('backendUsers/personal').alerts[0].recipient).toBe('drewstake3@gmail.com');expect(docs.has(`backendUsers/${ADMIN_UID}`)).toBe(false);
  });
  it('isolates two users including identical request IDs and disable capabilities',()=>{
    doPost(req({action:'create',input,idToken:token()}));asUser('personal','drewstake3@gmail.com');
    let account=doPost(req({action:'account',idToken:token(),uid:ADMIN_UID}));expect(account.data.workflows).toHaveLength(0);
    doPost(req({action:'create',input:{...input,target:90},idToken:token()}));
    account=doPost(req({action:'account',idToken:token(),uid:ADMIN_UID}));expect(account.data.workflows).toHaveLength(1);expect(account.data.workflows[0].buyTarget).toBe(90);
    expect(capability(ADMIN_UID)).not.toBe(capability('personal'));
    expect(doPost(req({action:'disable',token:capability('personal'),confirm:true})).ok).toBe(true);
    expect(stored('backendUsers/personal').alerts[0].workflow.paused).toBe(true);expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.paused).toBe(false);
  });
  it('atomically deduplicates creation, rejects changed settings, and preserves quota admission on retries',()=>{
    for(let i=0;i<2;i++)expect(doPost(req({action:'create',input,idToken:token()})).ok).toBe(true);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts).toHaveLength(1);expect(stored('backend/worker').admissions).toBe(1);
    expect(doPost(req({action:'create',input:{...input,target:90},idToken:token()})).ok).toBe(false);
    failCommit=true;expect(doPost(req({action:'create',input:{...input,requestId:'22345678-1234-4234-8234-123456789012'},idToken:token()})).ok).toBe(false);
    expect(stored('backend/worker').admissions).toBe(1);expect(stored(`backendUsers/${ADMIN_UID}`).alerts).toHaveLength(1);
  });
  it('requires explicit confirmation, makes GET harmless and disables idempotently',()=>{
    doPost(req({action:'create',input,idToken:token()}));const before=writes;
    expect(doGet().ok).toBe(false);expect(writes).toBe(before);
    expect(doPost(req({action:'disable',token:capability(ADMIN_UID)})).ok).toBe(false);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.paused).toBe(false);
    for(let i=0;i<2;i++)expect(doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true})).ok).toBe(true);
    expect(stored(`backendUsers/${ADMIN_UID}`).mail[0].status).toBe('cancelled');expect(sends).toBe(0);
  });
  it('migrates existing owner state and hash links without changing request IDs or token hashes',()=>{
    const state=emptyState(ADMIN_UID),hash=createHash('sha256').update(capability(ADMIN_UID)).digest('hex');
    createAlert(state,input,parseMarket(raw(),Date.now()),email,hash,Date.now());put('backend/state',state);
    expect(doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true})).ok).toBe(true);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].tokenHash).toBe(hash);expect(docs.has(`alertLinks/${hash}`)).toBe(true);
    expect(stored('backend/state').alerts[0].workflow.paused).toBe(false); // Original rollback record is preserved, never polled again.
  });
  it('enforces admission without charging idempotent retries',()=>{
    for(let i=0;i<5;i++)expect(doPost(req({action:'create',input:{...input,requestId:`12345678-1234-4234-8234-${String(i).padStart(12,'0')}`},idToken:token()})).ok).toBe(true);
    expect(doPost(req({action:'create',input,idToken:token()})).error).toMatch(/5 alerts per hour/);
    const c=loadControl().state;c.admissions=40;
    expect(()=>checkAdmission(c,emptyState('other'),Date.now())).toThrow(/capacity/);
    expect(()=>checkAdmission(c,emptyState('other'),Date.now()+86400001)).not.toThrow();
  });
  it('rejects unsupported origins, JSON preflight requests, and editor-only operations',()=>{
    expect(doPost(req({action:'snapshot',origin:'https://evil.test'})).ok).toBe(false);
    const r=req({action:'snapshot'});r.postData.type='application/json';expect(doPost(r).ok).toBe(false);
    expect(doPost(req({action:'sendTestConfirmation',idToken:token()})).ok).toBe(false);expect(writes).toBe(0);
  });
});
describe('Multi-user scheduled worker',()=>{
  it('edits the existing target, keeps links and mail intact, and checks the new target',()=>{
    doPost(req({action:'create',input,idToken:token()}));
    const before=stored(`backendUsers/${ADMIN_UID}`);
    const edit={action:'update',id:input.requestId,target:90,revision:0,idToken:token()};
    for(let i=0;i<2;i++)expect(doPost(req(edit)).data.workflow.buyTarget).toBe(90);
    const state=stored(`backendUsers/${ADMIN_UID}`);
    expect(state.alerts).toHaveLength(1);expect(state.alerts[0].workflow.revision).toBe(1);
    expect(state.alerts[0].tokenHash).toBe(before.alerts[0].tokenHash);
    expect(state.mail).toEqual(before.mail);expect(stored('backend/worker').admissions).toBe(1);
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(1);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.stage).toBe('watching_buy');
    expect(doPost(req({...edit,target:100,revision:1})).ok).toBe(true);
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(2);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.stage).toBe('completed');
    expect(doPost(req({...edit,target:120,revision:2})).error).toMatch(/no longer active/);
    expect(doPost(req({action:'create',input,idToken:token()})).ok).toBe(true);
    expect(doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true})).ok).toBe(true);
  });
  it('rejects another user, invalid values, stale edits and disabled alerts without mutation',()=>{
    doPost(req({action:'create',input,idToken:token()}));
    const edit={action:'update',id:input.requestId,target:90,revision:0};
    asUser('other','other@example.com');
    expect(doPost(req({...edit,idToken:token(),uid:ADMIN_UID})).error).toMatch(/Invalid alert/);
    asUser(ADMIN_UID,email);
    for(const target of [0,-1,'90',null,1e16])expect(doPost(req({...edit,target,idToken:token()})).ok).toBe(false);
    expect(doPost(req({...edit,idToken:token()})).ok).toBe(true);
    expect(doPost(req({...edit,target:80,idToken:token()})).error).toMatch(/changed elsewhere/);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.buyTarget).toBe(90);
    doPost(req({action:'disable',token:capability(ADMIN_UID),confirm:true}));
    expect(doPost(req({...edit,target:80,revision:1,idToken:token()})).error).toMatch(/no longer active/);
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.buyTarget).toBe(90);
  });
  it('checks users, sends to each validated recipient, and does not resend success',()=>{
    doPost(req({action:'create',input,idToken:token()}));asUser('personal','drewstake3@gmail.com');doPost(req({action:'create',input,idToken:token()}));
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(4);expect(deliveries.map(m=>m.to).sort()).toEqual([email,email,'drewstake3@gmail.com','drewstake3@gmail.com'].sort());
    expect(stored(`backendUsers/${ADMIN_UID}`).alerts[0].workflow.stage).toBe('completed');expect(stored('backendUsers/personal').alerts[0].workflow.stage).toBe('completed');
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(4);expect(Object.keys(properties).filter(k=>k.startsWith('sent:'))).toHaveLength(0);
  });
  it('shares the MailApp budget across users and defers when exhausted',()=>{
    doPost(req({action:'create',input,idToken:token()}));asUser('personal','drewstake3@gmail.com');doPost(req({action:'create',input,idToken:token()}));remaining=1;
    expect(scheduledPoll().ok).toBe(true);expect(sends).toBe(1);
    const mail=[...stored(`backendUsers/${ADMIN_UID}`).mail,...stored('backendUsers/personal').mail];
    expect(mail.filter(m=>m.status==='sent')).toHaveLength(1);expect(mail.filter(m=>m.status==='queued').every(m=>m.attempts===0)).toBe(true);
  });
  it('refuses an overlapping worker without writes or sends',()=>{locked=true;expect(scheduledPoll().ok).toBe(false);expect(writes).toBe(0);expect(sends).toBe(0);});
});
