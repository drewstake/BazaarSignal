import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

// These are encoded document-field bounds, not average compression ratios.
// `value` already has a single-field index exemption. No new indexed payload,
// collection, service, or retained version is needed.
export const inlineSnapshotLimits: Readonly<Record<string, number>> = {
  bazaar: 896 * 1024, catalog: 128 * 1024, election: 16 * 1024,
};
export const INLINE_RAW_LIMIT = 12 * 1024 ** 2;
export const INLINE_DOCUMENT_OVERHEAD = 8192;
export const INLINE_STORAGE_RESERVATION = 1152 * 1024;
export const INLINE_SNAPSHOT_PREFIX = 'market-br-v1:';
const prefix = INLINE_SNAPSHOT_PREFIX;
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export function encodeInlineSnapshot(key: string, value: string): string {
  const limit = inlineSnapshotLimits[key];
  if (!limit || Buffer.byteLength(value) > INLINE_RAW_LIMIT)
    throw new Error('Snapshot exceeds the reviewed inline bound');
  const compressed = brotliCompressSync(value, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_LGWIN]: 24,
  } });
  const encoded = `${prefix}${digest(compressed)}:${compressed.toString('base64')}`;
  if (Buffer.byteLength(encoded) > limit)
    throw new Error('Snapshot exceeds the reviewed inline bound');
  return encoded;
}

/** Legacy plain JSON and blob pointers remain readable across a rolling update. */
export function decodeInlineSnapshot(key: string, value: string): string {
  if (!value.startsWith(prefix)) {
    if (value.startsWith('market-br-')) throw new Error('Unknown inline snapshot format');
    return value;
  }
  const limit = inlineSnapshotLimits[key];
  if (!limit || Buffer.byteLength(value) > limit) throw new Error('Invalid inline snapshot size');
  const match = /^([a-f0-9]{64}):([A-Za-z0-9+/]+={0,2})$/.exec(value.slice(prefix.length));
  if (!match) throw new Error('Invalid inline snapshot encoding');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2] || digest(bytes) !== match[1])
    throw new Error('Invalid inline snapshot checksum');
  return brotliDecompressSync(bytes, { maxOutputLength: INLINE_RAW_LIMIT }).toString('utf8');
}
