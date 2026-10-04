import { describe, expect, it } from 'vitest';
// Deployment script is directly executable without a separate production build.
// @ts-expect-error JavaScript operator utility
import { verifyReleasePlan, uploadLocation, releasePatch, verifyLiveUpdate, verifyStoppedUpdate, verifySchedule } from '../scripts/private-trial-release.mjs';
import { createHash } from 'node:crypto';

const now = Date.parse('2026-10-01T16:50:00Z');
const receipt = { imageDigest: `sha256:${'a'.repeat(64)}`, applicationOnly: true,
  localRuntimeSmokeVerified: true, requiredBaseImage: 'us-central1-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/nodejs24',
  cloudBuildMinutes: 0, artifactStorageHoldBytes: 104000000, registryUploadBytes: 16000000 };
const plan = () => ({ project: 'bazaarsignal-510305', imageDigest: receipt.imageDigest, id: 'test',
  startsAt: '2026-10-01T17:00:00Z', expiresAt: '2026-10-01T17:12:00Z', shutdownGrantExpiresAt: '2026-10-01T17:15:00Z',
  observedAt: now, scopeEvidence: 'inventory', capacityEvidence: 'inventory', counterEvidence: 'console',
  meters: {
    cpuSeconds: { used: 35, hold: 10000, headroom: 10000, limit: 180000 },
    memoryGiBSeconds: { used: 35, hold: 10000, headroom: 10000, limit: 360000 },
    artifactBytes: { used: 208201877, hold: 104000000, headroom: 16000000, limit: .5 * 1024 ** 3 },
    logBytes: { used: 500000, hold: 16 * 1024 ** 2, headroom: 16 * 1024 ** 2, limit: 50 * 1024 ** 3 },
  } });
describe('private release admission', () => {
  it('accepts five-minute configuration only with an explicit paused release', () => {
    const p = { updateExistingLive: true, keepCollectionPaused: true, pausedSchedule: '*/5 * * * *' };
    expect(() => verifySchedule(p, { state: 'PAUSED', schedule: '*/5 * * * *' })).not.toThrow();
    expect(() => verifySchedule(p, { state: 'ENABLED', schedule: '*/5 * * * *' })).toThrow();
    expect(() => verifySchedule({ ...p, keepCollectionPaused: false }, { state: 'PAUSED', schedule: '*/5 * * * *' })).toThrow();
    expect(() => verifySchedule({ updateExistingLive: true }, { state: 'ENABLED', schedule: '*/5 * * * *' })).toThrow();
  });
  it('paused portfolio releases cannot enable or change the existing hourly schedule',()=>{
    const p={keepCollectionPaused:true,updateExistingLive:true};
    expect(()=>verifySchedule(p,{state:'PAUSED',schedule:'0 * * * *'})).not.toThrow();
    expect(()=>verifySchedule(p,{state:'ENABLED',schedule:'0 * * * *'})).toThrow();
    expect(()=>verifySchedule(p,{state:'PAUSED',schedule:'* * * * *'})).toThrow();
    expect(()=>verifySchedule({...p,keepCollectionPaused:false},{state:'ENABLED',schedule:'0 * * * *'})).toThrow();
    expect(()=>verifySchedule({}, {state:'PAUSED',schedule:'0 * * * *'})).toThrow();
  });
  it('explicit recovery deploys only against the unchanged inspected stopped ledger',()=>{
    const p:any={...plan(),operatingMode:'free-tier',updateExistingLive:true,recoverStopped:true,releaseId:'timeout-repair',services:['marketapi','refreshmarket']};
    const ledger={id:p.id,startsAt:Date.parse(p.startsAt),expiresAt:Date.parse(p.expiresAt),stoppedAt:now,reason:'The operation was aborted due to timeout',monthlyReserved:{cpuSeconds:500}};
    p.stoppedLedgerSha256=createHash('sha256').update(JSON.stringify(ledger)).digest('hex');
    const service={template:{containers:[{env:[{name:'MARKET_OPERATING_MODE',value:'free-tier'},{name:'MARKET_LIVE_ID',value:p.id},{name:'MARKET_LIVE_END',value:p.expiresAt}]}]}};
    expect(()=>verifyStoppedUpdate(p,ledger,service)).not.toThrow();
    for(const changed of [{...ledger,reason:'Budget reached'},{...ledger,monthlyReserved:{}},{...ledger,expiresAt:ledger.expiresAt+1}])
      expect(()=>verifyStoppedUpdate(p,changed,service)).toThrow();
    expect(()=>verifyStoppedUpdate({...p,recoverStopped:false},ledger,service)).toThrow();
    expect(()=>verifyStoppedUpdate({...p,services:['marketapi']},ledger,service)).toThrow();
    expect(ledger.stoppedAt).toBe(now);expect(ledger.monthlyReserved.cpuSeconds).toBe(500);
  });
  it('discloses existing image overage only for bounded existing-live releases without changing free allowance',()=>{
    const p={...plan(),operatingMode:'free-tier',updateExistingLive:true,startsAt:new Date(now-1000).toISOString(),
      existingImageOverageDisclosed:true,artifactCapacityCeilingBytes:1024**3};
    p.meters.artifactBytes.used=745985250;
    expect(()=>verifyReleasePlan(p,receipt,now)).not.toThrow();
    expect(()=>verifyReleasePlan({...p,existingImageOverageDisclosed:false},receipt,now)).toThrow(/headroom/);
    expect(()=>verifyReleasePlan({...p,updateExistingLive:false},receipt,now)).toThrow(/headroom/);
    p.meters.artifactBytes.used=1024**3;
    expect(()=>verifyReleasePlan(p,receipt,now)).toThrow(/headroom/);
  });
  it('permits only explicit read-budget recovery against the exact unchanged stopped ledger',()=>{
    const p:any={...plan(),operatingMode:'free-tier',updateExistingLive:true,recoverStopped:true,recoveryStopReason:'Free-tier operating budget reached: firestoreReads',releaseId:'budget-repair',services:['marketapi','refreshmarket']};
    const ledger={id:p.id,startsAt:Date.parse(p.startsAt),expiresAt:Date.parse(p.expiresAt),stoppedAt:now,reason:p.recoveryStopReason,dailyReserved:{firestoreReads:29972}};
    p.stoppedLedgerSha256=createHash('sha256').update(JSON.stringify(ledger)).digest('hex');
    const service={template:{containers:[{env:[{name:'MARKET_OPERATING_MODE',value:'free-tier'},{name:'MARKET_LIVE_ID',value:p.id},{name:'MARKET_LIVE_END',value:p.expiresAt}]}]}};
    expect(()=>verifyStoppedUpdate(p,ledger,service)).not.toThrow();
    expect(()=>verifyStoppedUpdate({...p,recoveryStopReason:undefined},ledger,service)).toThrow();
    expect(()=>verifyStoppedUpdate({...p,recoveryStopReason:'operator stop'},ledger,service)).toThrow();
    expect(()=>verifyStoppedUpdate(p,{...ledger,dailyReserved:{}},service)).toThrow();
  });
  it('an existing-live code update cannot renew the allowance or reopen a stopped ledger',()=>{
    const p={...plan(),operatingMode:'free-tier',releaseId:'timing-fix'};
    const ledger={id:p.id,startsAt:Date.parse(p.startsAt),expiresAt:Date.parse(p.expiresAt),monthlyReserved:{cpuSeconds:500}};
    const service={template:{containers:[{env:[{name:'MARKET_OPERATING_MODE',value:'free-tier'},{name:'MARKET_LIVE_ID',value:p.id},{name:'MARKET_LIVE_END',value:p.expiresAt}]}]}};
    expect(()=>verifyLiveUpdate(p,ledger,service)).not.toThrow();
    expect(()=>verifyLiveUpdate({...p,expiresAt:'2026-11-01T07:00:00Z'},ledger,service)).toThrow(/preserve/);
    expect(()=>verifyLiveUpdate(p,{...ledger,stoppedAt:now},service)).toThrow(/preserve/);
    expect(ledger.monthlyReserved.cpuSeconds).toBe(500);
  });
  it('fits the bounded private release without admitting a live trial', () => {
    expect(verifyReleasePlan(plan(), receipt, now)).toEqual({ start: now + 600000, end: now + 1320000 });
  });
  it('refuses partial or excessive headroom and stale evidence', () => {
    const p = plan(); p.meters.artifactBytes.used = 350000000;
    expect(() => verifyReleasePlan(p, receipt, now)).toThrow(/headroom/);
    expect(() => verifyReleasePlan({ ...plan(), observedAt: now - 1800001 }, receipt, now)).toThrow(/stale/);
    const low = plan(); low.meters.cpuSeconds.hold = 9999;
    expect(() => verifyReleasePlan(low, receipt, now)).toThrow(/reservation/);
  });
  it('does not deploy after the fixed start or beyond shutdown authority', () => {
    expect(() => verifyReleasePlan(plan(), receipt, now + 600000)).toThrow(/window/);
    expect(() => verifyReleasePlan({ ...plan(), expiresAt: '2026-10-01T17:13:00Z' }, receipt, now)).toThrow(/margin/);
  });
  it('never forwards registry credentials to another origin or path', () => {
    expect(uploadLocation('/v2/bazaarsignal-510305/gcf-artifacts/market-trial/blobs/uploads/test').hostname).toBe('us-central1-docker.pkg.dev');
    expect(uploadLocation('/artifacts-uploads/namespaces/bazaarsignal-510305/repositories/gcf-artifacts/uploads/example').hostname).toBe('us-central1-docker.pkg.dev');
    for (const url of ['https://evil.example/upload', 'http://us-central1-docker.pkg.dev/v2/upload', '/v2/another/repo/blobs/uploads/test'])
      expect(() => uploadLocation(url)).toThrow(/destination/);
  });
  it('allows only an explicit bounded free-tier release and applies its shorter runtime timeouts',()=>{
    const p={...plan(),operatingMode:'free-tier',id:'free-october',startsAt:new Date(now-1000).toISOString(),
      expiresAt:'2026-11-01T07:00:00Z',shutdownGrantExpiresAt:'2026-11-01T08:00:00Z'};
    expect(()=>verifyReleasePlan(p,receipt,now)).not.toThrow();
    expect(()=>verifyReleasePlan({...p,operatingMode:'trial'},receipt,now)).toThrow();
    const service={name:'projects/bazaarsignal-510305/locations/us-central1/services/marketapi',etag:'one',template:{containers:[{}]}};
    const patch=releasePatch(service,'marketapi',p);
    expect(patch.template.timeout).toBe('15s');
    expect(patch.template.containers[0].env).toContainEqual({name:'MARKET_OPERATING_MODE',value:'free-tier'});
  });
  it('preserves existing configuration while creating a bounded private revision', () => {
    const service = { name: 'projects/bazaarsignal-510305/locations/us-central1/services/marketapi', etag: 'one',
      template: { revision: 'old', annotations: { existing: 'keep' }, containers: [{ env: [{ name: 'PRESERVE', value: 'yes' }], command: ['old'] }] } };
    const patch = releasePatch(service, 'marketapi', plan());
    expect(patch.template.revision).toBeUndefined();
    expect(patch.template.annotations.existing).toBe('keep');
    expect(patch.template.containers[0].env).toContainEqual({ name: 'PRESERVE', value: 'yes' });
    expect(patch.template.containers[0].resources.startupCpuBoost).toBe(false);
    expect(patch.scaling.maxInstanceCount).toBe(1);
    expect(patch.template.scaling.maxInstanceCount).toBe(1);
    expect(service.template.revision).toBe('old');
    expect(() => releasePatch({ ...service, invokerIamDisabled: true }, 'marketapi', plan())).toThrow(/service/);
  });
});
