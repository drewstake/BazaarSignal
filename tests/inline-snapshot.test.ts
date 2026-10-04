import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decodeInlineSnapshot, encodeInlineSnapshot, inlineSnapshotLimits,
  INLINE_RAW_LIMIT, INLINE_DOCUMENT_OVERHEAD, INLINE_STORAGE_RESERVATION } from '../collector/inline-snapshot';
import { liveInvocationCharge, collectionEnvelope } from '../collector/allowance-live';

it('round trips the complete source snapshot and preserves legacy JSON', () => {
  const raw = JSON.stringify({ upstreamAt: 123, observedAt: 456,
    data: { raw: { buy_summary: [{ pricePerUnit: 1.234, amount: 99 }] }, item: '🐟' } });
  for (const key of Object.keys(inlineSnapshotLimits)) {
    expect(decodeInlineSnapshot(key, encodeInlineSnapshot(key, raw))).toBe(raw);
    expect(decodeInlineSnapshot(key, raw)).toBe(raw);
  }
});

it('rejects unknown, corrupt, oversized, or unsupported inline data without falling back', () => {
  expect(() => encodeInlineSnapshot('auctions', '{}')).toThrow('bound');
  expect(() => encodeInlineSnapshot('bazaar', 'x'.repeat(INLINE_RAW_LIMIT + 1))).toThrow('bound');
  expect(() => encodeInlineSnapshot('election', randomBytes(20_000).toString('base64'))).toThrow('bound');
  const encoded = encodeInlineSnapshot('bazaar', '{"upstreamAt":123}');
  expect(() => decodeInlineSnapshot('bazaar', encoded.slice(0, 20) + '0'.repeat(60))).toThrow();
  expect(() => decodeInlineSnapshot('bazaar', encoded + 'AAAA')).toThrow();
  expect(() => decodeInlineSnapshot('bazaar', 'market-br-v2:future')).toThrow('Unknown');
});

it('fits every inline document below Firestore and charges their full retained size', () => {
  const max = Object.values(inlineSnapshotLimits).reduce((n, size) => n + size + INLINE_DOCUMENT_OVERHEAD, 0);
  expect(max).toBeLessThan(INLINE_STORAGE_RESERVATION);
  for (const size of Object.values(inlineSnapshotLimits)) expect(size + INLINE_DOCUMENT_OVERHEAD).toBeLessThan(1024 ** 2);
  expect(collectionEnvelope('bazaar-inline').firestoreStorageBytes).toBe(INLINE_STORAGE_RESERVATION);
});

it('removes unused auction/upload holds for new Bazaar work without changing CPU, CAS or legacy limits', () => {
  const legacy = liveInvocationCharge('collector'), inline = liveInvocationCharge('collector', 'bazaar-inline');
  expect(inline).toMatchObject({ storageClassA: 0, snapshotUploads: 0, storageByteMonths: 0, hypixelRequests: 9 });
  for (const key of ['cpuSeconds', 'memoryGiBSeconds', 'firestoreReads', 'firestoreWrites', 'logBytes', 'collectorInvocations'])
    expect(inline[key], key).toBe(legacy[key]);
  expect(legacy.hypixelRequests).toBe(96);
  expect(legacy.storageClassA).toBe(4);
});
