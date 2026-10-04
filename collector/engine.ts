import { createHash } from "node:crypto";
import { normalizeBazaar } from "../shared/companion/bazaar";
import type {
  BazaarItem,
  FeeContext,
  Listing,
} from "../shared/companion/types";
import { feeContextFromElection } from "./fee-context";
import { normalizeListing, type Catalog } from "./normalize";
import { isFresh } from "../shared/market";
import { consistentSnapshot } from "../shared/companion/snapshot";
import type { CacheStore } from "./cache-store";
import { Coordinator, Deferred, emptyJob, type JobState } from "./coordinator";
import {
  auctionInterval,
  backoff,
  defaultPolicy,
  type MarketPolicy,
} from "./policy";
import { TrialStopped } from "./trial";
import { SnapshotReadCache } from './snapshot-read-cache';
import { AUCTION_COLLECTION_ENABLED } from '../shared/market-features';
export { consistentSnapshot } from "../shared/companion/snapshot";
export interface Snapshot<T> {
  version: string;
  upstreamAt: number;
  observedAt: number;
  data: T;
}
interface BazaarData {
  items: BazaarItem[];
  raw: any;
  names: Record<string, string>;
}
interface AuctionData {
  listings: Listing[];
  fees: FeeContext;
}
class UnchangedGeneration extends Error {}
export type CollectorMeasurement = (name: string, amount?: number) => void;
const unknownFees = (): FeeContext => ({
  mayor: "Unknown",
  multiplier: null,
  checkedAt: 0,
  explanation: "Waiting for election data; comparisons withheld.",
});

/** Only tick() fetches Hypixel. Public methods read complete shared snapshots. */
export class MarketCollector {
  readonly coordinator: Coordinator;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running = false;
  // Derived read caches only. Coordination, budgets and source snapshots remain durable/shared.
  private decoding = new Map<string, Promise<Snapshot<any> | null>>();
  constructor(
    public store: CacheStore,
    public policy: MarketPolicy = defaultPolicy,
    private network: typeof fetch = fetch,
    public now = Date.now,
    private random = Math.random,
    private measure: CollectorMeasurement = () => {},
    private refreshAlignmentMs = 0,
    private snapshots = new SnapshotReadCache(),
  ) {
    this.coordinator = new Coordinator(store, policy, now, random);
    this.now = this.coordinator.now;
  }
  async read<T>(key: string): Promise<Snapshot<T> | null> {
    const pending = this.decoding.get(key);
    if (pending) return pending;
    const work = this.readSnapshot<T>(key);
    this.decoding.set(key, work);
    try { return await work; }
    finally { this.decoding.delete(key); }
  }
  private async readSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
    const state = await this.coordinator.state(), job = state.jobs[key];
    // This identity and publication share an atomic transaction. Successful
    // unchanged checks intentionally leave the immutable identity unchanged.
    const tag = JSON.stringify([job?.observedAt, job?.snapshotVersion]);
    if (!job?.observedAt) return this.store.read(key).then(raw => raw ? JSON.parse(raw) : null);
    return this.snapshots.read<T>(key, tag, () => this.store.read(key));
  }
  async tick(keys = ["catalog", "election", "bazaar", "auctions"]) {
    keys = keys.filter(key => key !== 'auctions' || AUCTION_COLLECTION_ENABLED);
    if (!keys.length) return;
    if (this.running) return;
    this.running = true;
    let acquired = false;
    try {
      acquired = await this.coordinator.acquire();
      if (!acquired) return;
      this.measure("collectorLeasesAcquired");
      for (const key of keys) {
        const c = await this.coordinator.state(),
          job = c.jobs[key] ?? emptyJob();
        if (job.nextAt > this.now() || c.blockedUntil > this.now()) continue;
        await this.refresh(key, job);
      }
    } finally {
      try {
        if (acquired) {
          try { await this.coordinator.release(); }
          catch (e) { if (!(e instanceof TrialStopped)) throw e; }
        }
      } finally {
        this.running = false;
      }
    }
  }
  private async refresh(key: string, old: JobState) {
    const started = this.now();
    let cadence = old.cadenceMs,
      pages = old.pages;
    const fetchJson = async (path: string) => {
      const r = await this.coordinator.fetchJson(path, this.network);
      cadence = Math.max(cadence, r.maxAge);
      return r.data;
    };
    try {
      let data: unknown,
        upstreamAt = started,
        metadataVersion = "",
        contentVersion: string | undefined;
      if (key === "catalog") {
        const raw = await fetchJson("resources/skyblock/items");
        if (!Array.isArray(raw.items))
          throw new Error("Item catalog unavailable");
        data = Object.fromEntries(
          raw.items
            .filter((i: any) => typeof i.id === "string")
            .sort((a: any, b: any) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            .map((i: any) => [
              i.id,
              { name: i.name, tier: i.tier, category: i.category },
            ]),
        );
        contentVersion = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      } else if (key === "election") {
        data = feeContextFromElection(
          await fetchJson("resources/skyblock/election"),
          this.now(),
        );
        // The successful check time belongs in coordination. Rechecking an
        // unchanged fee profile must not upload a new immutable metadata blob.
        const { checkedAt: _checkedAt, ...profile } = data as FeeContext;
        contentVersion = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
      } else {
        const catalogSnapshot = await this.read<Catalog>("catalog");
        const electionSnapshot = await this.read<FeeContext>("election");
        const catalog = catalogSnapshot?.data ?? {};
        const electionJob = (await this.coordinator.state()).jobs.election;
        const fees = electionSnapshot ? {
          ...electionSnapshot.data,
          checkedAt: electionJob?.lastCheckedAt ?? electionSnapshot.data.checkedAt,
        } : unknownFees();
        metadataVersion = `:${catalogSnapshot?.version ?? "unknown"}:${electionSnapshot?.version ?? "unknown"}`;
        if (key === "bazaar") {
          const raw = await fetchJson("skyblock/bazaar");
          if (
            !isFresh(raw.lastUpdated, this.now()) ||
            !raw.products ||
            Array.isArray(raw.products)
          )
            throw new Error("Bazaar data stale or malformed");
          const priorSnapshot = await this.read<BazaarData>(key);
          if (priorSnapshot?.version === `${raw.lastUpdated}${metadataVersion}`) {
            data = priorSnapshot.data;
          } else {
            const previous = new Map(
              priorSnapshot?.data.items.map((i) => [i.id, i]),
            );
            const items: BazaarItem[] = [];
            for (const [id, product] of Object.entries(raw.products)) {
              try {
                items.push({
                  ...normalizeBazaar(
                    id,
                    product,
                    raw.lastUpdated,
                    this.now(),
                    catalog[id],
                    previous.get(id),
                  ),
                  feeContext: fees,
                });
              } catch {
                /* Invalid order books cannot inform pricing. */
              }
            }
            if (!items.length) throw new Error("No valid Bazaar products");
            data = {
              items,
              raw,
              names: Object.fromEntries(
                Object.entries(catalog).map(([id, i]) => [id, i.name]),
              ),
            };
          }
          upstreamAt = raw.lastUpdated;
        } else {
          await this.coordinator.capacity(pages || 1);
          // New controls carry the immutable identity in the same atomic
          // publication. Collection needs no previous listing payload at all.
          // Older deployed controls fall back to the complete stored snapshot.
          const previous = old.snapshotVersion ? { version: old.snapshotVersion } : await this.read<AuctionData>(key);
          const raw = await consistentSnapshot(fetchJson, {
            now: this.now,
            firstPage: async (first) => {
              pages = first.totalPages;
              // A successful first-page probe is not a complete refresh. Do not
              // fetch the remaining pages for an already-published generation.
              if (previous?.version === `${first.lastUpdated}${metadataVersion}` &&
                  (!old.snapshotVersion || await this.read<AuctionData>(key)))
                throw new UnchangedGeneration();
              await this.coordinator.capacity(pages - 1);
              // Avoid starting the expensive remainder near an observed cache boundary.
              // This is only a pacing hint; every page still has to agree exactly.
              const age = this.now() - first.lastUpdated;
              const expectedDuration = Math.max(
                old.durationMs,
                Math.ceil(pages / 3) * 250,
              );
              if (
                age >= 0 &&
                age < cadence &&
                age + expectedDuration + 2000 > cadence
              )
                throw new Deferred(
                  "Waiting for the next upstream generation to avoid mixed pages",
                  first.lastUpdated + cadence + 2000 + this.random() * 1000,
                );
            },
          });
          const listings: Listing[] = [];
          for (const event of raw.auctions) {
            try {
              const l = normalizeListing(
                event,
                raw.lastUpdated,
                this.now(),
                catalog,
              );
              if (l) listings.push(l);
            } catch {
              /* Malformed NBT is excluded, never treated as an exact match. */
            }
          }
          data = { listings, fees };
          upstreamAt = raw.lastUpdated;
        }
      }
      const now = this.now(),
        duration = now - started;
      const observedCadence =
        old.upstreamAt && upstreamAt > old.upstreamAt
          ? Math.min(120000, upstreamAt - old.upstreamAt)
          : 0;
      const interval =
        key === "auctions"
          ? auctionInterval(
              this.policy,
              pages,
              duration,
              Math.max(cadence, observedCadence),
            )
          : key === "bazaar"
            ? Math.max(this.policy.bazaarMs, cadence)
            : key === "catalog"
              ? this.policy.catalogMs
              : this.policy.electionMs;
      const snapshot: Snapshot<unknown> = {
        version: contentVersion ?? `${upstreamAt}${metadataVersion}`,
        upstreamAt,
        observedAt: now,
        data,
      };
      // Same source + same metadata means the existing immutable blob is still
      // authoritative. Keep its observedAt so readers do not download it again.
      // A different identity is sufficient proof of change. For an identical
      // identity, still verify the payload so eviction can be repaired.
      const previous = old.snapshotVersion && old.snapshotVersion !== snapshot.version
        ? { version: old.snapshotVersion, observedAt: old.observedAt }
        : await this.read<unknown>(key);
      const unchanged = previous?.version === snapshot.version;
      await this.coordinator.change((c) => {
        this.coordinator.assert(c);
        c.jobs[key] = {
          // Live admission separately permits one collection per clock slot.
          // Anchor successful due times so startup jitter cannot skip the next slot.
          nextAt: Math.max(this.refreshAlignmentMs && interval % this.refreshAlignmentMs === 0
            ? Math.floor(started / this.refreshAlignmentMs) * this.refreshAlignmentMs + interval
            : started + interval, now + 1000),
          upstreamAt,
          observedAt: unchanged ? previous.observedAt : now,
          snapshotVersion: snapshot.version,
          lastCheckedAt: now,
          durationMs: duration,
          lastAttemptDurationMs: duration,
          pages,
          intervalMs: interval,
          cadenceMs: cadence,
          failures: 0,
          error: null,
        };
        return {
          result: undefined,
          ...(unchanged ? {} : { payload: { key, value: JSON.stringify(snapshot) } }),
        };
      });
      this.measure(`${key}RefreshesCompleted`);
      this.measure(unchanged ? `${key}SnapshotsUnchanged` : `${key}SnapshotsPublished`);
    } catch (e) {
      if (e instanceof TrialStopped) throw e;
      if (e instanceof UnchangedGeneration) {
        await this.coordinator.change(c => {
          this.coordinator.assert(c);
          c.jobs[key] = { ...old, pages, failures: 0, error: null,
            lastAttemptDurationMs: this.now() - started,
            nextAt: this.now() + Math.max(old.intervalMs, cadence, this.policy.auctionMinMs) };
          return { result: undefined };
        });
        this.measure(`${key}GenerationProbesUnchanged`);
        return;
      }
      this.measure(`${key}RefreshesFailed`);
      await this.coordinator.change((c) => {
        this.coordinator.assert(c);
        const failures = old.failures + 1;
        c.jobs[key] = {
          ...old,
          pages,
          failures,
          error: message(e),
          lastAttemptDurationMs: this.now() - started,
          nextAt: Math.max(
            this.now() + backoff(failures, this.random),
            e instanceof Deferred ? e.until : 0,
          ),
        };
        return { result: undefined };
      });
    }
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const run = async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error("Market scheduler:", message(e));
      }
      if (!this.stopped) this.timer = setTimeout(run, 5000);
    };
    void run();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  async status(key = "auctions") {
    const c = await this.coordinator.state(),
      j = c.jobs[key] ?? emptyJob();
    const { snapshotVersion: _snapshotVersion, ...publicJob } = j;
    return {
      ...publicJob,
      stale: !j.upstreamAt || this.now() - j.upstreamAt > this.policy.staleMs,
      refreshing: !!c.lease && c.lease.until > this.now(),
      automatic: true,
      upstreamHeaders: c.responses?.[`skyblock/${key}`] ?? null,
      requestBudget: {
        limit: this.policy.requestLimit,
        windowMs: this.policy.windowMs,
        reserve: this.policy.reserve,
        used: c.requests.filter((r) => r.at > this.now() - this.policy.windowMs)
          .length,
        total: c.totalRequests,
        blockedUntil: c.blockedUntil,
        header: c.header,
      },
    };
  }
  async bazaar() {
    const snapshot = await this.read<BazaarData>("bazaar");
    if (!snapshot)
      throw new Error(
        "Bazaar cache is warming. Automatic updates will resume when the collector is available.",
      );
    const status = await this.status("bazaar");
    return {
      items: snapshot.data.items,
      version: snapshot.version,
      status,
      error: status.error,
    };
  }
  async rawBazaar() {
    const s = await this.read<BazaarData>("bazaar");
    if (!s)
      throw new Error("Market data unavailable; waiting for the shared cache.");
    return { ...s.data.raw, names: s.data.names };
  }
  async portfolioAuctions(assets: string[] = []) {
    if (!AUCTION_COLLECTION_ENABLED) throw new Error('Auction price updates are disabled. Saved holdings are preserved.');
    const s = await this.read<AuctionData>('auctions');
    if (!s) throw new Error('Auction price evidence unavailable from the shared cache.');
    // Public market evidence only. No private demand or portfolio records.
    const keys=new Set(assets),counts=new Map<string,number>();
    // A bounded sample of the 20 lowest exact asks. The lowest-price reference
    // is unchanged; counts and uncertainty describe this inspected sample.
    const listings=s.data.listings.filter(l=>keys.has(l.variant.fingerprint)&&l.status==='active'&&l.end>s.observedAt)
      .sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id)).filter(l=>{const n=counts.get(l.variant.fingerprint)??0;counts.set(l.variant.fingerprint,n+1);return n<20;});
    return {listings,version:s.version,status:await this.status('auctions'),sampleLimit:20};
  }
  async portfolioPrices(assets:string[] = []) {
    const keys=new Set(assets);
    const [bazaar,auctions]=await Promise.all([assets.some(id=>id.startsWith('bz_'))?this.read<BazaarData>('bazaar'):null,assets.some(id=>id.startsWith('v1_'))?this.portfolioAuctions(assets).catch(()=>null):null]);
    return {bazaar:bazaar?.data.items.filter(i=>keys.has(`bz_${i.id}`))??[],listings:auctions?.listings??[],fixture:false};
  }
}
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Market request failed";
