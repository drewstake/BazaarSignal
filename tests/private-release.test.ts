import { describe, expect, it } from 'vitest';
// Deployment script is directly executable without a separate production build.
// @ts-expect-error JavaScript operator utility
import { verifyReleasePlan, uploadLocation, releasePatch } from '../scripts/private-trial-release.mjs';

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
