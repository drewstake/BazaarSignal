import { randomUUID } from "node:crypto";
import type { Firestore, DocumentSnapshot } from "firebase-admin/firestore";
import type { CacheStore } from "./cache-store";

export interface SnapshotBlobs {
  put(name: string, value: string): Promise<void>;
  get(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  list(): Promise<{ name: string; createdAt: number }[]>;
}
const snapshotKeys = new Set(["catalog", "election", "bazaar", "auctions"]);
const prefix = "market-current/";

/** Firestore holds only coordination and pointers. Large immutable blobs are private.
 * A conditional atomic batch publishes pointer and control AFTER upload completes.
 * Failed/ambiguous commits leave staging blobs for bounded cleanup, never deleting
 * something that might have become the authoritative snapshot.
 */
export class GoogleCacheStore implements CacheStore {
  private offset = 0;
  private clockAt = 0;
  private reads = new Map<string, { until: number; value: string | null }>();
  private inflight = new Map<string, Promise<string | null>>();
  constructor(
    readonly db: Firestore,
    readonly blobs: SnapshotBlobs,
    readonly collection = "marketCache",
    readonly readCacheMs = 0,
  ) {}
  private ref(key: string) {
    if (!/^[a-z-]+$/.test(key)) throw new Error("Invalid cache key");
    return this.db.collection(this.collection).doc(key);
  }
  private observe(s: DocumentSnapshot) {
    this.offset = s.readTime.toMillis() - Date.now();
    this.clockAt = Date.now();
  }
  async time() {
    if (Date.now() - this.clockAt > 1000)
      this.observe(await this.ref("control").get());
    return Date.now() + this.offset;
  }
  async read(key: string) {
    const cached = this.reads.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const work = (async () => {
      const s = await this.ref(key).get();
      this.observe(s);
      const data = s.data();
      const value = data?.blob
        ? await this.blobs.get(data.blob)
        : (data?.value ?? null);
      // Snapshot JSON is decoded/cached by MarketCollector; avoid a second large cache.
      if (this.readCacheMs && !snapshotKeys.has(key))
        this.reads.set(key, { value, until: Date.now() + this.readCacheMs });
      return value as string | null;
    })();
    this.inflight.set(key, work);
    try { return await work; }
    finally { this.inflight.delete(key); }
  }
  async commit(
    key: string,
    expected: string | null,
    value: string,
    payload?: { key: string; value: string },
  ) {
    if (snapshotKeys.has(key)) throw new Error("Snapshots require atomic publication");
    if (payload && (key !== "control" || !snapshotKeys.has(payload.key)))
      throw new Error("Invalid snapshot publication");
    let blob: string | null = null;
    try {
      const ref = this.ref(key), current = await ref.get();
      this.observe(current);
      const old = current.data()?.value ?? null;
      if (old !== expected) return false;
      const batch = this.db.batch();
      if (payload) {
        const lease = old && JSON.parse(old).lease;
        if (!lease || lease.until <= current.readTime.toMillis()) return false;
        // Reject already-stale candidates BEFORE a paid upload. The batch still
        // checks the original version after upload, fencing concurrent owners.
        blob = `${prefix}${payload.key}/${randomUUID()}.json.gz`;
        await this.blobs.put(blob, payload.value);
        if (lease.until <= await this.time()) return false;
        batch.set(this.ref(payload.key), { blob, publishedAt: current.readTime });
      }
      // Optimistic CAS avoids 100 losing claimants holding pessimistic read
      // locks while the winner tries to charge requests. The server checks the
      // control document version and commits BOTH writes atomically.
      if (current.exists)
        batch.update(ref, { value }, { lastUpdateTime: current.updateTime! });
      else batch.create(ref, { value });
      await batch.commit();
      return true;
    } catch (error) {
      // ALREADY_EXISTS / FAILED_PRECONDITION / ABORTED did not commit. Reread
      // the winning state; ambiguous failures remain visible to the caller.
      if ([6, 9, 10].includes((error as { code?: number }).code ?? -1)) return false;
      throw error;
    } finally {
      this.reads.delete(key);
    }
  }
  /** Current blobs are never removed. Ten-minute staging/read grace exceeds leases
   * and HTTP timeouts. No completed-sale or snapshot history is exposed or retained.
   */
  async cleanup(intervalMs = 3_600_000) {
    // Durable admission across instances. A crashed cleanup consumes its slot;
    // it is safer to retain an orphan until the next hour than repeatedly list.
    const now = await this.time();
    const previous = await this.read("cleanup");
    if (previous && JSON.parse(previous).nextAt > now) return false;
    if (!await this.commit("cleanup", previous, JSON.stringify({ nextAt: now + intervalMs }))) return false;
    const docs = await this.db.getAll(...[...snapshotKeys].map(k => this.ref(k)));
    const live = new Set(docs.map(d => d.data()?.blob).filter(Boolean));
    for (const file of await this.blobs.list()) {
      if (file.name.startsWith(prefix) && !live.has(file.name) &&
          file.createdAt < now - 600_000)
        await this.blobs.remove(file.name);
    }
    return true;
  }
  async close() { this.reads.clear(); }
}
