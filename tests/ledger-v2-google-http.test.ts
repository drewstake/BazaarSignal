import {expect,it,vi} from 'vitest';
// @ts-expect-error local ESM tooling
import {GoogleManagementHttp,classifyRequest,DB} from '../scripts/ledger-v2-google-http.mjs';
// @ts-expect-error local ESM tooling
import {receiptQuery} from '../scripts/ledger-v2-observe.mjs';
const ledger=`https://firestore.googleapis.com/v1/${DB}/marketCache/paid-budget-october`;
it.each(['https://marketapi-k5a64sgi2q-uc.a.run.app/','https://refreshmarket-k5a64sgi2q-uc.a.run.app/',
  'https://script.google.com/macros/s/example/exec','https://script.googleapis.com/v1/scripts/id:run',
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send','https://run.googleapis.com.evil.invalid/v2/foo',
  'https://user:secret@run.googleapis.com/v2/foo'])('blocks application and untrusted URL %s before auth',async url=>{
  const token=vi.fn(),fetchImpl=vi.fn(),http=new GoogleManagementHttp({token,fetchImpl});
  await expect(http.request(url)).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();
});
it('blocks writes by default but permits the bounded receipt query',async()=>{
  const fetchImpl=vi.fn(async()=>new Response('[]')),token=vi.fn(async()=>'secret');
  const http=new GoogleManagementHttp({token,fetchImpl});
  await expect(http.request(`https://firestore.googleapis.com/v1/${DB}:commit`,{method:'POST',body:{}})).rejects.toThrow('not authorized');
  expect(fetchImpl).not.toHaveBeenCalled();
  await http.json(`https://firestore.googleapis.com/v1/${DB}:runQuery`,{method:'POST',body:receiptQuery()});
  expect(fetchImpl).toHaveBeenCalledTimes(1);expect(http.journal.requests[0].readOnly).toBe(true);
  expect(JSON.stringify(http.journal)).not.toContain('secret');
});
it('persists intent, refuses redirects, bounds responses and never retries',async()=>{
  const order:string[]=[],http=new GoogleManagementHttp({token:async()=>'secret',save:async()=>{order.push('saved');},
    fetchImpl:async(_url:string,options:any)=>{order.push('fetch');expect(options.redirect).toBe('error');return new Response('x'.repeat(20));}});
  await expect(http.request(ledger,{limit:10})).rejects.toThrow('bound');expect(order.slice(0,2)).toEqual(['saved','fetch']);expect(http.journal.calls).toBe(1);
});
it('redacts provider errors and keeps an ambiguous response uncertain',async()=>{
  const http=new GoogleManagementHttp({token:async()=>'secret',fetchImpl:async()=>{throw Error('Bearer secret private body');}});
  await expect(http.request(ledger)).rejects.toThrow('outcome unknown');expect(JSON.stringify(http.journal)).not.toContain('secret');
  expect(http.journal.requests[0].status).toBe('uncertain');
});
it('retains HTTP call limits across restarts',async()=>{
  const fetchImpl=vi.fn(),http=new GoogleManagementHttp({token:async()=>'secret',fetchImpl,journal:{calls:2,responseBytes:0,requests:[]},maxCalls:2});
  await expect(http.request(ledger)).rejects.toThrow('budget');expect(fetchImpl).not.toHaveBeenCalled();
});
it('rejects unrelated or unbounded Firestore queries',()=>{
  expect(()=>classifyRequest(`https://firestore.googleapis.com/v1/${DB}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'users'}],limit:1}})).toThrow();
  const query=receiptQuery();query.structuredQuery.limit=4002;
  expect(()=>classifyRequest(`https://firestore.googleapis.com/v1/${DB}:runQuery`,'POST',query)).toThrow();
});
const registryBlob='https://us-central1-docker.pkg.dev/v2/bazaarsignal-510305/gcf-artifacts/market-trial/blobs/sha256:'+'a'.repeat(64);
it('follows one bounded same-repository Artifact Registry download redirect',async()=>{
  const calls:any[]=[],location='/artifacts-downloads/namespaces/bazaarsignal-510305/repositories/gcf-artifacts/downloads/known-token';
  const http=new GoogleManagementHttp({token:async()=>'secret',fetchImpl:async(url:string,options:any)=>{
    calls.push({url,options});return calls.length===1?new Response(null,{status:307,headers:{location}}):new Response('verified bytes');}});
  expect((await http.request(registryBlob,{limit:14})).bytes.toString()).toBe('verified bytes');
  expect(calls[0].options.redirect).toBe('manual');expect(calls[1].options.redirect).toBe('error');
  expect(calls[1].url).toBe('https://us-central1-docker.pkg.dev'+location);
  expect(http.journal.requests.every((r:any)=>r.readOnly)).toBe(true);expect(http.journal.calls).toBe(2);
});
it.each(['https://evil.invalid/download','/artifacts-downloads/namespaces/other/repositories/gcf-artifacts/downloads/token','/artifacts-downloads/namespaces/bazaarsignal-510305/repositories/gcf-artifacts/downloads/token?secret=x'])('never forwards credentials to an unreviewed download redirect %s',async location=>{
  const fetchImpl=vi.fn(async()=>new Response(null,{status:307,headers:{location}}));
  const http=new GoogleManagementHttp({token:async()=>'secret',fetchImpl});await expect(http.request(registryBlob)).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('keeps the original response bound across the registry redirect',async()=>{
  let calls=0;const http=new GoogleManagementHttp({token:async()=>'secret',fetchImpl:async()=>++calls===1?
    new Response(null,{status:302,headers:{location:'/artifacts-downloads/namespaces/bazaarsignal-510305/repositories/gcf-artifacts/downloads/token'}}):new Response('oversized')});
  await expect(http.request(registryBlob,{limit:2})).rejects.toThrow('bound');expect(calls).toBe(2);
});
