import { expect,it,vi } from 'vitest';
import { readPublishedUsage } from '../src/companion/usage-report';
import { publishOwnerUsage } from '../server/publish-usage';
import { measureDashboard } from '../collector/usage-dashboard';
import { publishableUsageReport } from '../shared/published-usage';

const fixture=()=>measureDashboard({store:{read:async()=>null,commit:async()=>false,close:async()=>{}},
  token:async()=>'',network:async()=>new Response('{}')});
it('reads only the owner report operation with Firebase auth, preserving stale timestamps and unknown measurements',async()=>{
  const report=await fixture();report.generatedAt-=86400000;report.nextMeasurementAt-=86400000;
  const backend=vi.fn(async()=>report);
  const read=await readPublishedUsage({token:'private-token',backend:backend as any});
  expect(backend).toHaveBeenCalledExactlyOnceWith({action:'usage-report'},'private-token',undefined);
  expect(read.generatedAt).toBe(report.generatedAt);expect(read.nextMeasurementAt).toBe(report.nextMeasurementAt);
  expect(read.spending.total).toBeNull();expect(read.publishedReport).toBe(true);
});
it.each([401,403,404,500])('reports HTTP %s without falling back to the paused market API or inventing measurements',async status=>{
  const backend=vi.fn(async()=>{throw new Error(`HTTP ${status}`);});
  await expect(readPublishedUsage({token:'token',backend})).rejects.toThrow();
  expect(backend).toHaveBeenCalledOnce();
});
it('CAS-publishes exactly one private document, never writes client permissions, and does not refresh observation times',async()=>{
  const report=await fixture();report.localReport='Local-only detail';let saved:any=null;
  const writes:string[]=[];
  const request=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/config/access'))return Response.json({fields:{ownerUid:{stringValue:'owner'}}});
    if(init?.method==='PATCH') {writes.push(url);saved={...JSON.parse(String(init.body)),updateTime:'2026-10-04T19:00:00Z'};return Response.json(saved);}
    return saved?Response.json(saved):new Response('{}',{status:404});
  });
  expect((await publishOwnerUsage(report,request)).changed).toBe(true);
  expect(writes).toHaveLength(1);expect(writes[0]).toContain('/owners/owner/reports/usage?currentDocument.exists=false');
  expect(JSON.parse(saved.fields.json.stringValue)).toMatchObject({generatedAt:report.generatedAt,publishedReport:true});
  expect(saved.fields.json.stringValue).not.toContain('Local-only detail');
  expect((await publishOwnerUsage(report,request)).changed).toBe(false);expect(writes).toHaveLength(1);
});
it('refuses older publications and retains uncertain outcomes without retrying writes',async()=>{
  const report=await fixture();
  const newer={fields:{json:{stringValue:JSON.stringify(publishableUsageReport({...report,generatedAt:report.generatedAt+1}))}},updateTime:'v1'};
  const request=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/config/access')
    ?Response.json({fields:{ownerUid:{stringValue:'owner'}}}):Response.json(newer));
  await expect(publishOwnerUsage(report,request)).rejects.toThrow('newer timestamp');
  expect(request.mock.calls.every(([,init])=>!init?.method)).toBe(true);
  const uncertain=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/config/access'))return Response.json({fields:{ownerUid:{stringValue:'owner'}}});
    if(init?.method==='PATCH')throw new Error('Uncertain transport');
    return new Response('{}',{status:404});
  });
  await expect(publishOwnerUsage(report,uncertain)).rejects.toThrow('Uncertain');
  expect(uncertain.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
});
