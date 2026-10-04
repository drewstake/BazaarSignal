import { emptyState, publicState } from './core';
import type { State } from './core';
declare const UrlFetchApp:any, ScriptApp:any, CacheService:any;
export const DOCUMENT='projects/bazaarsignal/databases/(default)/documents';
const ROOT=`https://firestore.googleapis.com/v1/${DOCUMENT}`;
export const ADMIN_UID='SPP408J6vxUDjtSMHn1E2LhrOum2';
export function fetchJson(url:string,options:any={}) {
  const r=UrlFetchApp.fetch(url,{...options,muteHttpExceptions:true});
  if(r.getResponseCode()<200 || r.getResponseCode()>=300) throw new Error('Upstream service unavailable.');
  return JSON.parse(r.getContentText());
}
export function firestore(path:string,method='get',payload?:unknown) {
  return fetchJson(`${ROOT}${path}`,{method,headers:{Authorization:`Bearer ${ScriptApp.getOAuthToken()}`},
    ...(payload ? {contentType:'application/json',payload:JSON.stringify(payload)} : {})});
}
export function readDoc(path:string) {
  const r=UrlFetchApp.fetch(`${ROOT}/${path}`,{headers:{Authorization:`Bearer ${ScriptApp.getOAuthToken()}`},muteHttpExceptions:true});
  if(r.getResponseCode()===404)return null;
  if(r.getResponseCode()!==200)throw new Error('Alert storage unavailable.');
  return JSON.parse(r.getContentText());
}
export function jsonWrite(path:string,value:unknown,version:string|null,fields:any={}) {
  const json=JSON.stringify(value);
  if(json.length>700000)throw new Error('Alert storage limit reached.');
  return {update:{name:`${DOCUMENT}/${path}`,fields:{...fields,json:{stringValue:json}}},
    currentDocument:version?{updateTime:version}:{exists:false}};
}
export const commit=(writes:any[])=>firestore(':commit','post',{writes});
export function needsWork(state:State) {
  return state.alerts.some(a=>!a.test && !a.workflow.paused &&
    state.mail.some(m=>m.alertId===a.workflow.id && ['queued','sending'].includes(m.status)));
}
export interface UserRecord {state:State;version:string|null;legacy:boolean;savedJson?:string;active?:boolean}
export function loadUser(uid:string):UserRecord {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new Error('Invalid user identity.');
  let doc=readDoc(`backendUsers/${uid}`),legacy=false;
  if(!doc && uid===ADMIN_UID){doc=readDoc('backend/state');legacy=Boolean(doc);}
  if(!doc)return {state:emptyState(uid),version:null,legacy:false};
  const state=JSON.parse(doc.fields.json.stringValue) as State;
  if(state.schema!==1 || state.ownerUid!==uid)throw new Error('Stored alerts belong to a different user.');
  return {state,version:legacy?null:doc.updateTime,legacy,savedJson:doc.fields.json.stringValue,active:doc.fields.active?.booleanValue};
}
export function persistUser(record:UserRecord,additional:any[]=[]) {
  const state=record.state,uid=state.ownerUid;
  const json=JSON.stringify(state),active=needsWork(state);
  if(!record.legacy && !additional.length && record.savedJson===json && record.active===active)return;
  const indexWrites=record.legacy?state.alerts.map(a=>linkWrite(a.tokenHash,uid,a.workflow.id)):[];
  const result=commit([
    jsonWrite(`backendUsers/${uid}`,state,record.version,{active:{booleanValue:active}}),
    {update:{name:`${DOCUMENT}/users/${uid}/status/main`,fields:{json:{stringValue:JSON.stringify(publicState(state))}}}},
    ...indexWrites,...additional]);
  record.version=result.writeResults[0].updateTime;record.legacy=false;record.savedJson=json;record.active=active;
  if(active)CacheService.getScriptCache().remove('legacy-mail-idle');
}
export function linkWrite(tokenHash:string,uid:string,alertId:string) {
  return {update:{name:`${DOCUMENT}/alertLinks/${tokenHash}`,fields:{uid:{stringValue:uid},alertId:{stringValue:alertId}}},currentDocument:{exists:false}};
}
export interface Control {
  monitor:State['monitor'];cursor:string;runtimeWindow:number;runtimeMs:number;
  admissionWindow:number;admissions:number;
}
export interface ControlRecord {state:Control;version:string|null}
export function loadControl():ControlRecord {
  const doc=readDoc('backend/worker');
  return doc?{state:JSON.parse(doc.fields.json.stringValue),version:doc.updateTime}:
    {state:{monitor:emptyState('').monitor,cursor:'',runtimeWindow:Date.now(),runtimeMs:0,admissionWindow:Date.now(),admissions:0},version:null};
}
export function saveControl(record:ControlRecord) {
  const result=commit([jsonWrite('backend/worker',record.state,record.version)]);record.version=result.writeResults[0].updateTime;
}
export function activeUsers(cursor:string):UserRecord[] {
  const rows=firestore(':runQuery','post',{structuredQuery:{from:[{collectionId:'backendUsers'}],
    where:{fieldFilter:{field:{fieldPath:'active'},op:'EQUAL',value:{booleanValue:true}}},
    orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:100,
    ...(cursor?{startAt:{values:[{referenceValue:`${DOCUMENT}/backendUsers/${cursor}`}],before:false}}:{})}});
  return rows.filter((r:any)=>r.document).map((r:any)=>({state:JSON.parse(r.document.fields.json.stringValue),version:r.document.updateTime,legacy:false,savedJson:r.document.fields.json.stringValue,active:r.document.fields.active?.booleanValue} as UserRecord));
}
// Admitted creates share a conservative budget so a public signup cannot enqueue unlimited mail.
export function checkAdmission(control:Control,state:State,now:number) {
  const recent=state.alerts.filter(a=>!a.test && a.workflow.createdAt>now-86400000);
  if(recent.filter(a=>a.workflow.createdAt>now-3600000).length>=5)throw new Error('You can create at most 5 alerts per hour.');
  if(recent.length>=20)throw new Error('You can create at most 20 alerts per day.');
  if(now-control.admissionWindow>=86400000){control.admissionWindow=now;control.admissions=0;}
  if(control.admissions>=40)throw new Error('Free alert capacity is full for today. Please try again later.');
}
