import { createAlert, deliver, disableAlert, enqueueTestTarget, fingerprint, parseMarket, poll, publicState, retryDelay } from './core';
import type { Mail, Market, RecordAlert, State } from './core';
import type { PriceAlertInput } from '../shared/model';
import { confirmation, updatePriceAlertTarget } from '../shared/price-alert';
import { ADMIN_UID, fetchJson, firestore, readDoc, loadUser, persistUser, linkWrite, loadControl, saveControl, activeUsers, needsWork, checkAdmission, jsonWrite } from './store';
import type { UserRecord } from './store';
import { sharedMarket } from './companion';
import { PORTFOLIO_EVALUATION_ENABLED } from '../shared/companion/portfolio-policy';
import { portfolioNotificationRequest, runPortfolioNotifications } from './portfolio-backend';
declare const PropertiesService:any, ScriptApp:any, Session:any, UrlFetchApp:any,
  Utilities:any, LockService:any, ContentService:any, CacheService:any, MailApp:any;
const PROJECT='bazaarsignal', SENDER='bazaarsignal@gmail.com';
const props=()=>PropertiesService.getScriptProperties();
/** Operator-only editor action, never routed from doPost. No email or user writes. */
export function configureFreeTierMarket() {
  settings();
  const end='2026-11-01T07:00:00.000Z';
  if(Date.now()>=Date.parse(end))throw new Error('This reviewed allowance period has expired.');
  props().setProperties({MARKET_OPERATING_MODE:'free-tier',MARKET_UPDATES_PAUSED:'false',
    MARKET_TRIAL_START:new Date().toISOString(),MARKET_TRIAL_END:end});
  return 'Hourly cached market bridge enabled until '+end;
}
function settings() {
  const p = props().getProperties();
  if (!p.FIREBASE_API_KEY || !/^[a-f0-9]{64}$/.test(p.TOKEN_KEY || '') ||
      p.APP_URL !== 'https://bazaarsignal.web.app') throw new Error('Backend setup is incomplete.');
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== SENDER) throw new Error('Deploy and authorize using the configured sender account.');
  return p;
}
export function verifyIdentity(token:unknown, apiKey:string, now=Date.now()) {
  if (typeof token!=='string' || token.length>12000 || token.split('.').length!==3) throw new Error('Sign in with the verified Google account.');
  // accounts:lookup validates the Firebase signature and project. Never use decoded claims alone.
  let result:any, claims:any;
  try {
    result=fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {method:'post',contentType:'application/json',payload:JSON.stringify({idToken:token})});
    claims=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1])).getDataAsString());
  } catch { throw new Error('Sign in again with the verified Google account.'); }
  const u=result.users?.[0];
  if (!u || result.users.length!==1 || u.disabled || u.emailVerified!==true ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(u.localId || '') || typeof u.email!=='string' || !u.email.includes('@') ||
      claims.sub!==u.localId || claims.aud!==PROJECT || claims.iss!==`https://securetoken.google.com/${PROJECT}` ||
      claims.email_verified!==true || claims.email?.toLowerCase()!==u.email.toLowerCase() ||
      claims.firebase?.sign_in_provider!=='google.com' || !u.providerUserInfo?.some((p:any)=>p.providerId==='google.com') ||
      !Number.isFinite(claims.exp) || claims.exp*1000<=now || !Number.isFinite(claims.iat) || claims.iat*1000>now+30000 ||
      !Number.isFinite(claims.auth_time) || claims.auth_time*1000>now+30000 ||
      (u.validSince && claims.auth_time<Number(u.validSince))) throw new Error('Use a verified Google account to create and manage your alerts.');
  return {uid:u.localId,email:u.email.toLowerCase()};
}
function locked<T>(work:()=>T,wait=5000):T {
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(wait)) throw new Error('Another operation is in progress. Retry shortly.');
  try { return work(); } finally { lock.releaseLock(); }
}
function hex(bytes:number[]) { return bytes.map(x=>(x&255).toString(16).padStart(2,'0')).join(''); }
function hash(value:string) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8)); }
function disableToken(id:string,uid:string,p:any) {
  return hex(Utilities.computeHmacSha256Signature(`disable:v1:${uid}:${id}`,p.TOKEN_KEY,Utilities.Charset.UTF_8));
}
function market():Market {
  const raw=sharedMarket('raw-bazaar');
  return parseMarket(raw,Date.now(),raw.names ?? {});
}
function send(mail:Mail,alert:RecordAlert,state:State,p:any) {
  const w=alert.workflow;
  let subject:string,body:string;
  if (mail.kind==='confirmation') {
    const token=disableToken(w.id,state.ownerUid,p);
    if (hash(token)!==alert.tokenHash) throw new Error('Token signing key changed.');
    subject=`BazaarSignal: alert created for ${w.itemName}`;
    const testUrl=(p.ALLOWED_ORIGINS || '').split(',').find((x:string)=>/^https:\/\/bazaarsignal--free-preview-[a-z0-9]+\.web\.app$/.test(x));
    body=confirmation(w,`${alert.test && testUrl ? testUrl : p.APP_URL}/#disable=${token}`,Date.now()).message;
  } else {
    subject=`BazaarSignal: target reached for ${w.itemName}`;
    body=[subject,'',`Quantity: ${w.quantity}`,`Estimated ${mail.quote!.side==='buy'?'instant-buy cost':'net instant-sale proceeds'}: ${mail.quote!.unit} coins per item; ${mail.quote!.total} coins total.`,
      ...(mail.quote!.side==='sell'?[`Sale calculations include ${w.taxRate}% tax.`]:[]), `Market snapshot: ${new Date(mail.quote!.timestamp).toISOString()}.`,
      'This alert has completed. Prices can move before you trade. All trades are manual.'].join('\n');
  }
  body+='\n\nChecks run approximately every five minutes and can miss brief price movements. MailApp acceptance does not guarantee inbox delivery.';
  if (alert.test) {subject=`[TEST] ${subject}`;body='Authorized BazaarSignal delivery test.\n\n'+body;}
  // No Gmail password, OAuth token, or recipient supplied by the browser.
  MailApp.sendEmail({to:alert.recipient,subject,body,name:'BazaarSignal'});
}
function deliverRecord(record:UserRecord,p:any,started:number,test=false) {
  const prefix=`sent:${record.state.ownerUid}:`;
  deliver(record.state,{now:()=>Date.now(),quota:()=>Math.min(MailApp.getRemainingDailyQuota(),record.state.monitor.quota ?? Infinity),
    save:()=>persistUser(record),send:(mail,alert)=>send(mail,alert,record.state,p),
    receipt:id=>Number(props().getProperty(prefix+id)) || (record.state.ownerUid===ADMIN_UID?Number(props().getProperty(`sent:${id}`)):0) || null,
    remember:(id,at)=>props().setProperty(prefix+id,String(at)),
    forget:id=>props().deleteProperty(prefix+id),budgetExpired:()=>Date.now()-started>45000},test);
}
const output=(body:unknown)=>ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
function publicMonitor() {
  const cache=CacheService.getScriptCache(),hit=cache.get('monitor-public');
  if(hit)return JSON.parse(hit);
  const monitor=loadControl().state.monitor;cache.put('monitor-public',JSON.stringify(monitor),60);return monitor;
}
function accountData(record:UserRecord) {
  return {...publicState(record.state),monitoring:needsWork(record.state)?record.state.monitor:publicMonitor()};
}
export function doGet() {return output({ok:false,error:'Use the website. GET requests never modify alerts.'});}
export function doPost(e:any) {
  try {
    if(!e?.postData?.contents || e.postData.contents.length>20000 || !/^text\/plain(?:;|$)/i.test(e.postData.type || ''))throw new Error('Invalid request.');
    const request=JSON.parse(e.postData.contents),p=settings();
    const origins=[p.APP_URL,...(p.ALLOWED_ORIGINS || '').split(',').map((x:string)=>x.trim()).filter(Boolean)];
    if(request.version!==1 || !origins.includes(request.origin))throw new Error('Website origin is not configured.');
    if(!['account','create','update','disable','portfolio-notification','legacy-pause'].includes(request.action))throw new Error('Unsupported operation.');
    if(request.action==='disable') {
      if(request.confirm!==true || !/^[a-f0-9]{64}$/.test(request.token || ''))throw new Error('Confirm using the button in your alert link.');
      return output({ok:true,data:locked(()=>{
        const tokenHash=hash(request.token),link=readDoc(`alertLinks/${tokenHash}`);
        let record:UserRecord;
        if(link)record=loadUser(link.fields.uid.stringValue);
        else {record=loadUser(ADMIN_UID);if(!record.legacy || !record.state.alerts.some(a=>a.tokenHash===tokenHash))throw new Error('Invalid alert link.');}
        disableAlert(record.state,tokenHash,Date.now());persistUser(record);return {disabled:true};
      })});
    }
    const identity=verifyIdentity(request.idToken,p.FIREBASE_API_KEY);
    if(request.action==='portfolio-notification')return output({ok:true,data:locked(()=>portfolioNotificationRequest(identity,request))});
    if(request.action==='legacy-pause')return output({ok:true,data:locked(()=>{const record=loadUser(identity.uid),alert=record.state.alerts.find(a=>a.workflow.id===request.id&&!a.test);if(!alert)throw new Error('Invalid alert.');disableAlert(record.state,alert.tokenHash,Date.now());persistUser(record);return {disabled:true};})});
    if(request.action==='account')return output({ok:true,data:accountData(loadUser(identity.uid))});
    if(request.action==='update')return output({ok:true,data:locked(()=>{
      const record=loadUser(identity.uid);
      const alert=record.state.alerts.find(a=>a.workflow.id===request.id && !a.test);
      if(!alert)throw new Error('Invalid alert.');
      alert.workflow=updatePriceAlertTarget(alert.workflow,request.target,request.revision,Date.now());
      persistUser(record);
      return {workflow:alert.workflow};
    })});
    // Old links/records remain usable, but a cached old client cannot start new
    // standalone targets. Retry of an existing request ID stays idempotent.
    if(!loadUser(identity.uid).state.alerts.some(a=>a.workflow.id===request.input?.requestId))throw new Error('Unsupported operation. New notifications must belong to a portfolio holding.');
    return output({ok:true,data:locked(()=>{
      const state=loadUser(identity.uid).state,input=request.input as PriceAlertInput,fp=fingerprint(input);
      const existing=state.alerts.find(a=>a.workflow.id===input.requestId);
      if(!existing || existing.fingerprint!==fp || existing.test)throw new Error('Request ID already used for different alert settings.');
      return {id:input.requestId,emailStatus:state.mail.find(m=>m.alertId===input.requestId && m.kind==='confirmation')?.status??'cancelled'};
    })});  } catch(e) {
    const message=e instanceof Error?e.message:'';
    const safe=/^(Sign in|Use a verified|Use an upward|Notification |Backend setup|Deploy and authorize|Website origin|Unsupported operation|Invalid |This alert |Target price |Confirm using|Another operation|Request ID|You can have|You can create|Free alert capacity|The 100|Wait for|Item unavailable|Market data|No valid market|Alert storage|Stored alerts)/.test(message);
    return output({ok:false,error:safe?message:'Service temporarily unavailable. Retry shortly.'});
  }
}
/** Retired legacy evaluation never reads prices. Only previously queued mail drains. */
export function scheduledPoll() {
  const started=Date.now();
  try {
    const p=settings();
    return locked(()=>{
      const cache=CacheService.getScriptCache();
      // No standalone creation remains. Explicit record mutations invalidate this
      // idle hint; cache loss causes a bounded read, never lost delivery work.
      if(cache.get('legacy-mail-idle') && !PORTFOLIO_EVALUATION_ENABLED)return {ok:true,idle:true};
      if(!cache.get('legacy-ledger-checked')) {
        const legacy=loadUser(ADMIN_UID);if(legacy.legacy)persistUser(legacy);
        cache.put('legacy-ledger-checked','1',21600);
      }
      const control=loadControl(),c=control.state,m=c.monitor;
      let records=activeUsers(c.cursor);if(!records.length&&c.cursor){c.cursor='';records=activeUsers('');}
      if(!records.length&&!PORTFOLIO_EVALUATION_ENABLED){cache.put('legacy-mail-idle','1',3600);return {ok:true,idle:true};}
      if(Date.now()-c.runtimeWindow>=86400000){c.runtimeWindow=Date.now();c.runtimeMs=0;}
      if(c.runtimeMs>=70*60000)return {ok:false};
      // Retire only the work index for records with no queued mail. Their ledger,
      // targets, disable links and migration rollback records are preserved.
      const due=records.filter(record=>needsWork(record.state)&&record.state.mail.some(mail=>
        mail.status==='queued'?mail.nextAttempt<=Date.now():mail.status==='sending'&&mail.leaseUntil<=Date.now()));
      for(const record of records)if(!needsWork(record.state))persistUser(record);
      if(!due.length&&!PORTFOLIO_EVALUATION_ENABLED){
        const cursor=records[records.length-1]?.state.ownerUid??'';
        if(c.cursor!==cursor){c.cursor=cursor;saveControl(control);}
        return {ok:true,deferred:true};
      }
      m.enabled=true;m.lastAttempt=Date.now();m.quota=MailApp.getRemainingDailyQuota();
      m.error='Legacy price evaluation is retired. Previously queued messages retain delivery and retry handling.';
      // Reserve runtime before sending; crash/retry cannot erase its reservation.
      c.runtimeMs+=47000;saveControl(control);
      for(const record of due) {
        if(Date.now()-started>40000)break;
        try {deliverRecord(record,p,started);persistUser(record);}catch { /* Isolate accounts; durable receipts permit retry. */ }
        c.cursor=record.state.ownerUid;
      }
      runPortfolioNotifications(started);
      m.quota=MailApp.getRemainingDailyQuota();c.runtimeMs+=Date.now()-started+2000-47000;saveControl(control);
      cache.put('monitor-public',JSON.stringify(m),60);
      return {ok:true};
    },100);
  } catch {return {ok:false,error:'Worker did not complete. Check authorization, storage and trigger status.'};}
}
/** Minute timer is a cheap clock gate; off-slot ticks do no I/O or email work. */
export function scheduledMinuteTick() {
  const now=Date.now();
  if(Math.floor(now/60000)%5!==0)return {ok:true,skipped:true};
  return scheduledPoll();
}
/** Owner-only migration; preserves the existing allowance and all user data. */
export function installAlignedTrigger() {
  settings();return locked(()=>{
    const triggers=ScriptApp.getProjectTriggers();
    const aligned=triggers.filter((t:any)=>t.getHandlerFunction()==='scheduledMinuteTick');
    // Create before removing the old trigger so a creation failure leaves it working.
    if(!aligned.length)ScriptApp.newTrigger('scheduledMinuteTick').timeBased().everyMinutes(1).create();
    for(const t of [...aligned.slice(1),...triggers.filter((t:any)=>t.getHandlerFunction()==='scheduledPoll')])ScriptApp.deleteTrigger(t);
    return {installed:true,clockMinutes:1,marketChecksPerHour:1,queuedMailMinutes:5};
  });
}
export function installTrigger() {
  if(props().getProperty('MARKET_OPERATING_MODE')==='free-tier')return installAlignedTrigger();
  settings();return locked(()=>{
    const triggers=ScriptApp.getProjectTriggers().filter((t:any)=>t.getHandlerFunction()==='scheduledPoll');
    if(!triggers.length)ScriptApp.newTrigger('scheduledPoll').timeBased().everyMinutes(5).create();
    for(const t of triggers.slice(1))ScriptApp.deleteTrigger(t);
    const control=loadControl();control.state.monitor.enabled=true;saveControl(control);return {installed:true,minutes:5};
  });
}
export function diagnostics() {
  settings();return {sender:SENDER,triggerCount:ScriptApp.getProjectTriggers().filter((t:any)=>['scheduledPoll','scheduledMinuteTick'].includes(t.getHandlerFunction())).length,
    remainingRecipients:MailApp.getRemainingDailyQuota(),monitoring:loadControl().state.monitor};
}
// Existing sender-authorized editor tests retain their original request IDs/links.
export function sendTestConfirmation() {
  const p=settings();if(p.TEST_RECIPIENT!=='drewstake3@gmail.com')throw new Error('Set the explicitly authorized test recipient in Script Properties.');
  const started=Date.now();return locked(()=>{
    const record=loadUser(ADMIN_UID);if(record.legacy)persistUser(record);
    const id=p.TEST_REQUEST_ID || Utilities.getUuid();props().setProperty('TEST_REQUEST_ID',id);
    record.state.monitor.quota=MailApp.getRemainingDailyQuota();
    if(!record.state.alerts.some(a=>a.workflow.id===id)) {
      const tokenHash=hash(disableToken(id,ADMIN_UID,p));
      createAlert(record.state,{requestId:id,itemId:'SUMMONING_EYE',side:'buy',quantity:1,target:1e15,taxRate:1.25},market(),p.TEST_RECIPIENT,tokenHash,Date.now(),true);
      persistUser(record,[linkWrite(tokenHash,ADMIN_UID,id)]);
    }
    deliverRecord(record,p,started,true);return {status:record.state.mail.find(m=>m.alertId===id && m.kind==='confirmation')?.status};
  });
}
export function sendTestTarget() {
  const p=settings();if(p.TEST_RECIPIENT!=='drewstake3@gmail.com' || !p.TEST_REQUEST_ID)throw new Error('Run the authorized confirmation test first.');
  const started=Date.now();return locked(()=>{
    const record=loadUser(ADMIN_UID);record.state.monitor.quota=MailApp.getRemainingDailyQuota();
    enqueueTestTarget(record.state,p.TEST_REQUEST_ID,market(),Date.now());persistUser(record);deliverRecord(record,p,started,true);
    return {status:record.state.mail.find(m=>m.alertId===p.TEST_REQUEST_ID && m.kind==='target')?.status};
  });
}
