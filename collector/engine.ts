import { normalizeBazaar } from "../shared/companion/bazaar";
import {
  auctionOpportunity,
  confidenceRank,
  defaultAuctionFilters,
  matchesAuction,
  valueVariant,
} from "../shared/companion/auctions";
import type {
  AuctionFilters,
  BazaarItem,
  CollectorHealth,
  FeeContext,
  Listing,
  Sale,
  Valuation,
} from "../shared/companion/types";
import { feeContextFromElection } from "./fee-context";
import {
  decodeVariant,
  normalizeListing,
  normalizeSale,
  type Catalog,
} from "./normalize";
import { LocalHistory, type HistoryStore } from "./store";
import { isFresh } from "../shared/market";

export type FetchJson = (path: string) => Promise<any>;
export const upstream: FetchJson = async (path) => {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://api.hypixel.net/v2/${path}`, {
        signal: AbortSignal.timeout(12000),
        headers: process.env.HYPIXEL_API_KEY
          ? { "API-Key": process.env.HYPIXEL_API_KEY }
          : {},
      });
      if (!r.ok) {
        if (r.status === 429)
          throw new Error(
            `Upstream rate limit; retry later (${r.headers.get("Retry-After") ?? "unknown"} seconds).`,
          );
        throw new Error(`Hypixel HTTP ${r.status}`);
      }
      const data = (await r.json()) as any;
      if (data.success !== true)
        throw new Error("Hypixel response unsuccessful");
      return data;
    } catch (e) {
      error = e;
      if (String(e).includes("rate limit")) break;
      if (attempt < 2)
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw error;
};
export function recordCoverage(previous: number, current: number) {
  return previous > 0 && current - previous > 60000
    ? { from: previous, to: current - 60000 }
    : null;
}
// Firestore's free quotas reset near midnight Pacific, not the host's UTC day.
export const quotaDay = (timestamp = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
export async function consistentSnapshot(
  fetchJson: FetchJson,
): Promise<{ auctions: any[]; lastUpdated: number }> {
  const first = await fetchJson("skyblock/auctions?page=0");
  if (
    !Number.isSafeInteger(first.totalPages) ||
    first.totalPages < 1 ||
    first.totalPages > 200 ||
    !isFresh(first.lastUpdated) ||
    first.page !== 0 ||
    !Array.isArray(first.auctions)
  )
    throw new Error("Invalid auction snapshot");
  const all = [...first.auctions];
  // Small batches respect upstream pressure. Commit only after EVERY page agrees.
  for (let page = 1; page < first.totalPages; page += 3) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(3, first.totalPages - page) }, (_, i) =>
        fetchJson(`skyblock/auctions?page=${page + i}`),
      ),
    );
    pages.forEach((p, i) => {
      if (
        p.page !== page + i ||
        p.lastUpdated !== first.lastUpdated ||
        p.totalPages !== first.totalPages ||
        !Array.isArray(p.auctions)
      )
        throw new Error(
          "Auction snapshot changed during pagination; previous cache preserved.",
        );
      all.push(...p.auctions);
    });
  }
  const ids = new Set(all.map((x) => x.uuid));
  if (ids.size !== all.length || all.length !== first.totalAuctions)
    throw new Error("Partial or duplicate auction snapshot");
  return { auctions: all, lastUpdated: first.lastUpdated };
}
export class MarketCollector {
  bazaar: BazaarItem[] = [];
  listings = new Map<string, Listing>();
  sales = new Map<string, Sale>();
  catalog: Catalog = {};
  health: CollectorHealth;
  private catalogAt = 0;
  private bazaarPending: Promise<void> | null = null;
  feeContext: FeeContext = {
    mayor: "Unknown",
    multiplier: null,
    checkedAt: 0,
    explanation: "Waiting for current election data.",
  };
  private activePending: Promise<void> | null = null;
  private endedPending: Promise<void> | null = null;
  private init: Promise<void> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastBazaarAttempt = 0;
  private lastActiveAttempt = 0;
  private day = quotaDay();
  constructor(
    private store: HistoryStore = new LocalHistory(),
    private fetchJson: FetchJson = upstream,
    private scope: string[] = [],
  ) {
    const writeLimit = Number(process.env.COLLECTOR_DAILY_WRITE_LIMIT ?? 12000);
    if (
      !Number.isSafeInteger(writeLimit) ||
      writeLimit < 100 ||
      writeLimit > 15000
    )
      throw new Error(
        "Daily write limit must be an integer from 100 to 15000.",
      );
    this.health = {
      mode: store.mode,
      startedAt: Date.now(),
      lastEndedSuccess: 0,
      lastActiveSuccess: 0,
      endedUpstreamAt: 0,
      activeUpstreamAt: 0,
      missedMs: 0,
      gaps: [],
      saleCount: 0,
      variantCount: 0,
      listingCount: 0,
      rejectedCount: 0,
      error: null,
      scope,
      writesToday: 0,
      writeLimit,
      writeDay: this.day,
    };
  }
  initialize() {
    return (this.init ??= (async () => {
      const saved = await this.store.load();
      saved.sales
        .filter((s) => s.soldAt >= Date.now() - 14 * 86400000)
        .forEach((s) => this.sales.set(s.id, s));
      if (saved.health) {
        const old = saved.health;
        this.health = {
          ...this.health,
          endedUpstreamAt: old.endedUpstreamAt,
          missedMs: old.missedMs,
          gaps: old.gaps,
          error: old.error,
          writesToday:
            (old.writeDay ?? quotaDay(old.lastEndedSuccess)) === this.day
              ? old.writesToday
              : 0,
        };
      }
      await Promise.all([this.loadCatalog(), this.loadFees()]);
    })().catch((e) => {
      this.init = null;
      throw e;
    }));
  }
  private async loadFees() {
    if (Date.now() - this.feeContext.checkedAt < 300000) return;
    try {
      this.feeContext = feeContextFromElection(
        await this.fetchJson("resources/skyblock/election"),
      );
    } catch {
      this.feeContext = {
        mayor: "Unknown",
        multiplier: null,
        checkedAt: Date.now(),
        explanation: "Election request failed; tax assumptions unavailable.",
      };
    }
  }
  private async loadCatalog() {
    if (Date.now() - this.catalogAt < 86400000) return;
    const raw = await this.fetchJson("resources/skyblock/items");
    if (!Array.isArray(raw.items)) throw new Error("Item catalog unavailable");
    this.catalog = Object.fromEntries(
      raw.items
        .filter((x: any) => typeof x.id === "string")
        .map((x: any) => [
          x.id,
          { name: x.name, tier: x.tier, category: x.category },
        ]),
    );
    this.catalogAt = Date.now();
  }
  async refreshBazaar() {
    if (this.bazaarPending) return this.bazaarPending;
    if (Date.now() - this.lastBazaarAttempt < 30000) return;
    this.lastBazaarAttempt = Date.now();
    this.bazaarPending = (async () => {
      await Promise.all([this.loadCatalog(), this.loadFees()]);
      const raw = await this.fetchJson("skyblock/bazaar");
      if (
        !isFresh(raw.lastUpdated) ||
        !raw.products ||
        Array.isArray(raw.products)
      )
        throw new Error("Bazaar data stale or malformed");
      const previous = new Map(this.bazaar.map((x) => [x.id, x])),
        products: BazaarItem[] = [];
      for (const [id, product] of Object.entries(raw.products)) {
        try {
          products.push({
            ...normalizeBazaar(
              id,
              product,
              raw.lastUpdated,
              Date.now(),
              this.catalog[id],
              previous.get(id),
            ),
            feeContext: this.feeContext,
          });
        } catch {
          /* Isolate malformed products. */
        }
      }
      if (!products.length) throw new Error("No valid Bazaar products");
      this.bazaar = products;
    })().finally(() => {
      this.bazaarPending = null;
    });
    return this.bazaarPending;
  }
  async refreshEnded() {
    if (this.endedPending) return this.endedPending;
    let priorCoverage = {
      endedUpstreamAt: this.health.endedUpstreamAt,
      lastEndedSuccess: this.health.lastEndedSuccess,
      missedMs: this.health.missedMs,
      gaps: this.health.gaps,
    };
    this.endedPending = (async () => {
      await this.initialize();
      priorCoverage = {
        endedUpstreamAt: this.health.endedUpstreamAt,
        lastEndedSuccess: this.health.lastEndedSuccess,
        missedMs: this.health.missedMs,
        gaps: this.health.gaps,
      };
      await this.loadFees();
      const raw = await this.fetchJson("skyblock/auctions_ended"),
        now = Date.now();
      if (!isFresh(raw.lastUpdated) || !Array.isArray(raw.auctions))
        throw new Error("Ended feed stale or malformed");
      if (raw.lastUpdated <= this.health.endedUpstreamAt) return;
      const gap = recordCoverage(this.health.endedUpstreamAt, raw.lastUpdated);
      if (gap) {
        this.health.gaps = [...this.health.gaps, gap].slice(-100);
        this.health.missedMs += gap.to - gap.from;
      }
      const day = quotaDay(now);
      if (day !== this.day) {
        this.day = day;
        this.health.writeDay = day;
        this.health.writesToday = 0;
      }
      const changed = new Set<string>();
      for (const event of raw.auctions) {
        const existing = this.sales.get(event.auction_id);
        if (existing) {
          changed.add(existing.variant.fingerprint);
          continue;
        }
        try {
          // Decode before filtering scope: exact stable IDs, never display names.
          const sale = normalizeSale(event, now, this.catalog);
          if (
            !sale ||
            (this.scope.length && !this.scope.includes(sale.variant.itemId))
          )
            continue;
          this.sales.set(sale.id, sale);
          changed.add(sale.variant.fingerprint);
          const listing = this.listings.get(sale.id);
          if (listing) listing.status = "sold";
        } catch {
          this.health.rejectedCount++;
        }
      }
      for (const [id, sale] of this.sales)
        if (sale.soldAt < now - 14 * 86400000) this.sales.delete(id);
      if (this.sales.size > 100000)
        throw new Error(
          "Local history cap reached; narrow COLLECTOR_ITEM_IDS before continuing.",
        );
      this.health.lastEndedSuccess = now;
      this.health.endedUpstreamAt = raw.lastUpdated;
      this.health.saleCount = this.sales.size;
      this.health.variantCount = new Set(
        [...this.sales.values()].map((s) => s.variant.fingerprint),
      ).size;
      this.health.error = null;
      const history = [...this.sales.values()],
        aggregates = new Map();
      for (const fingerprint of changed) {
        const variant = history.find(
          (s) => s.variant.fingerprint === fingerprint,
        )!.variant;
        aggregates.set(
          fingerprint,
          valueVariant(variant, history, [], now, this.health.missedMs > 0),
        );
      }
      await this.store.commit(history, this.health, aggregates);
    })()
      .catch((e) => {
        Object.assign(this.health, priorCoverage);
        this.health.error = message(e);
        throw e;
      })
      .finally(() => {
        this.endedPending = null;
      });
    return this.endedPending;
  }
  async refreshActive(force = false) {
    if (this.activePending) return this.activePending;
    if (Date.now() - this.lastActiveAttempt < (force ? 15000 : 60000)) return;
    this.lastActiveAttempt = Date.now();
    this.activePending = (async () => {
      await this.initialize();
      const raw = await consistentSnapshot(this.fetchJson),
        now = Date.now(),
        next = new Map<string, Listing>();
      for (const event of raw.auctions) {
        try {
          const listing = normalizeListing(
            event,
            raw.lastUpdated,
            now,
            this.catalog,
          );
          if (
            listing &&
            (!this.scope.length || this.scope.includes(listing.variant.itemId))
          )
            next.set(listing.id, listing);
        } catch {
          this.health.rejectedCount++;
        }
      }
      // Disappearance is UNAVAILABLE, never evidence of a sale.
      for (const [id, old] of this.listings)
        if (!next.has(id) && now - old.end < 3600000)
          next.set(id, {
            ...old,
            status: this.sales.has(id)
              ? "sold"
              : old.end <= now
                ? "expired"
                : "unavailable",
          });
      this.listings = next;
      this.health.lastActiveSuccess = now;
      this.health.activeUpstreamAt = raw.lastUpdated;
      this.health.listingCount = [...next.values()].filter(
        (l) => l.status === "active",
      ).length;
    })()
      .catch((e) => {
        this.health.error = message(e);
        throw e;
      })
      .finally(() => {
        this.activePending = null;
      });
    return this.activePending;
  }
  start() {
    if (this.timers.length) return;
    const run = (job: () => Promise<unknown>) => {
      void job().catch((e) => {
        this.health.error = message(e);
      });
    };
    run(() => this.refreshEnded());
    run(() => this.refreshActive());
    this.timers.push(
      setInterval(() => run(() => this.refreshEnded()), 30000),
      setInterval(() => run(() => this.refreshActive()), 120000),
    );
  }
  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
  list(filters: Partial<AuctionFilters>, page = 0) {
    const f = sanitizeFilters(filters),
      now = Date.now(),
      history = [...this.sales.values()],
      active = [...this.listings.values()];
    const byVariant = new Map<string, Sale[]>(),
      asks = new Map<string, Listing[]>(),
      values = new Map<string, Valuation>();
    for (const sale of history) {
      const key = sale.variant.fingerprint;
      if (!byVariant.has(key)) byVariant.set(key, []);
      byVariant.get(key)!.push(sale);
    }
    for (const listing of active)
      if (
        listing.status === "active" &&
        listing.end > now &&
        isFresh(listing.upstreamAt, now)
      ) {
        const key = listing.variant.fingerprint;
        if (!asks.has(key)) asks.set(key, []);
        asks.get(key)!.push(listing);
      }
    for (const group of asks.values()) group.sort((a, b) => a.price - b.price);
    const candidates = active
      .filter((l) => l.status === "active" && l.end > now)
      .map((l) => {
        const current =
          now - l.upstreamAt > 180000 || l.upstreamAt > now + 30000
            ? { ...l, status: "stale" as const }
            : l;
        const key = l.variant.fingerprint;
        if (!values.has(key))
          values.set(
            key,
            valueVariant(
              l.variant,
              byVariant.get(key) ?? [],
              [],
              now,
              this.health.missedMs > 0,
            ),
          );
        const valuation = { ...values.get(key)! },
          competitors = asks.get(key) ?? [];
        const competitor =
          competitors[0]?.id === l.id ? competitors[1] : competitors[0];
        if (valuation.estimate !== null && competitor)
          valuation.estimate = Math.min(valuation.estimate, competitor.price);
        return auctionOpportunity(
          current,
          [],
          [],
          now,
          f.durationHours,
          this.health.missedMs > 0,
          valuation,
          this.feeContext,
        );
      })
      .filter((o) => matchesAuction(o, f, now));
    candidates.sort((a, b) => {
      const score = (o: typeof a) =>
        f.sort === "roi"
          ? (o.roi ?? -Infinity)
          : f.sort === "capital"
            ? -o.listing.price
            : f.sort === "recent"
              ? o.listing.start
              : f.sort === "confidence"
                ? confidenceRank[o.valuation.confidence]
                : (o.profit ?? -Infinity);
      return score(b) - score(a) || a.listing.id.localeCompare(b.listing.id);
    });
    return {
      items: candidates.slice(page * 6, page * 6 + 6),
      total: candidates.length,
      page,
      health: this.health,
    };
  }
  detail(id: string, hours = 24) {
    const listing = this.listings.get(id);
    if (!listing) return null;
    return auctionOpportunity(
      listing,
      [...this.sales.values()],
      [...this.listings.values()],
      Date.now(),
      hours,
      this.health.missedMs > 0,
      undefined,
      this.feeContext,
    );
  }
  async recheck(id: string) {
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("Invalid auction ID");
    if (process.env.HYPIXEL_API_KEY) {
      const data = await this.fetchJson(`skyblock/auction?uuid=${id}`),
        now = Date.now();
      const raw = data.auctions?.find((a: any) => a.uuid === id);
      const listing = raw
        ? normalizeListing(raw, now, now, this.catalog)
        : null;
      if (listing) this.listings.set(id, listing);
      return {
        status: listing
          ? "active"
          : this.sales.has(id)
            ? "sold"
            : raw?.end <= now
              ? "expired"
              : "unavailable",
        checkedAt: now,
        command: listing ? `/viewauction ${id}` : null,
        source: "specific-auction",
      };
    }
    await this.refreshActive(true);
    const listing = this.listings.get(id),
      now = Date.now();
    const status = !listing
      ? "unavailable"
      : listing.end <= now
        ? "expired"
        : now - this.health.activeUpstreamAt > 75000
          ? "stale"
          : listing.status;
    return {
      status,
      checkedAt: now,
      command: status === "active" ? `/viewauction ${id}` : null,
      source: "latest-complete-cached-snapshot",
    };
  }
}
export function sanitizeFilters(
  input: Partial<AuctionFilters>,
): AuctionFilters {
  const f = { ...defaultAuctionFilters };
  for (const key of Object.keys(f) as (keyof AuctionFilters)[]) {
    const value = input[key];
    if (
      typeof value === typeof f[key] &&
      (typeof value !== "number" || Number.isFinite(value)) &&
      (typeof value !== "string" || value.length <= 100)
    )
      (f as any)[key] = value;
  }
  if (![1, 6, 12, 24, 48].includes(f.durationHours)) f.durationHours = 24;
  if (!Object.hasOwn(confidenceRank, f.confidence)) f.confidence = "medium";
  return f;
}
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Market request failed";
