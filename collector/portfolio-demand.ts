import {
  validPortfolioHolding,
  type Holding,
} from "../shared/companion/portfolio";
import { PORTFOLIO_COLLECTION_ENABLED } from "../shared/companion/portfolio-policy";
import { AUCTION_COLLECTION_ENABLED } from '../shared/market-features';
import type { MarketCollector } from "./engine";
export interface Demand {
  version: 1;
  sampledAt: number;
  complete: boolean;
  bazaar: string[];
  auctions: string[];
}
export interface DemandReader {
  reserveReads(count: number): Promise<void>;
  page(
    cursor: string | null,
    limit: number,
  ): Promise<{
    rows: { path: string; holding: Holding }[];
    next: string | null;
  }>;
  portfolio(path: string): Promise<{ deleted: boolean } | null>;
}
/** Server-only scan with bounded pagination and allowance reservation before I/O. */
export async function readPortfolioDemand(
  reader: DemandReader,
  now = Date.now(),
): Promise<Demand> {
  const rows: { holding: Holding; portfolioDeleted: boolean }[] = [],
    parents = new Map<string, boolean>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    await reader.reserveReads(100);
    const result = await reader.page(cursor, 100);
    if (result.rows.length > 100) throw new Error("Invalid demand page.");
    for (const row of result.rows) {
      if (!/^users\/[^/]+\/portfolios\/[^/]+\/holdings\/[^/]+$/.test(row.path))
        continue;
      const parent = row.path.split("/").slice(0, 4).join("/");
      if (!parents.has(parent)) {
        await reader.reserveReads(1);
        const p = await reader.portfolio(parent);
        parents.set(parent, !p || p.deleted);
      }
      rows.push({
        holding: row.holding,
        portfolioDeleted: parents.get(parent)!,
      });
    }
    if (result.next === null) return aggregateDemand(rows, now);
    if (result.next === cursor || !result.next)
      throw new Error("Non-progressing demand scan.");
    cursor = result.next;
  }
  throw new Error(
    "Demand scan bound reached. No partial report may collect markets.",
  );
}
// Only public asset keys may leave the authorized private aggregation boundary.
// No UIDs, portfolio IDs, quantities, costs, settings or per-user counts.
export function aggregateDemand(
  rows: Iterable<{ holding: Holding; portfolioDeleted: boolean }>,
  now = Date.now(),
): Demand {
  const bazaar = new Set<string>(),
    auctions = new Set<string>();
  let scanned = 0;
  for (const { holding, portfolioDeleted } of rows) {
    if (++scanned > 100000)
      throw new Error(
        "Demand scan exceeded the reviewed bound; no partial demand published.",
      );
    if (!validPortfolioHolding(holding))
      throw new Error("Invalid private holding; demand scan incomplete.");
    if (holding.deleted || portfolioDeleted || (holding.kind === 'auction' && !AUCTION_COLLECTION_ENABLED)) continue;
    (holding.kind === "bazaar" ? bazaar : auctions).add(
      holding.kind === "bazaar" ? holding.itemId : holding.id,
    );
    if (bazaar.size + auctions.size > 5000)
      throw new Error("Shared tracked-asset capacity reached.");
  }
  return {
    version: 1,
    sampledAt: now,
    complete: true,
    bazaar: [...bazaar].sort(),
    auctions: [...auctions].sort(),
  };
}
export function demandJobs(d: Demand, now = Date.now()) {
  if (
    !d ||
    d.version !== 1 ||
    d.complete !== true ||
    !Number.isSafeInteger(d.sampledAt) ||
    d.sampledAt > now + 30000 ||
    now - d.sampledAt > 3600000 ||
    !Array.isArray(d.bazaar) ||
    !Array.isArray(d.auctions) ||
    d.bazaar.length + d.auctions.length > 5000 ||
    d.bazaar.some((id) => !/^[A-Za-z0-9_:-]{1,100}$/.test(id)) ||
    d.auctions.some((id) => !/^v1_[a-f0-9]{64}$/.test(id))
  )
    throw new Error(
      "Missing, incomplete or stale portfolio demand. Collection stays paused.",
    );
  const needsAuctions = AUCTION_COLLECTION_ENABLED && d.auctions.length > 0;
  if (!d.bazaar.length && !needsAuctions) return [];
  return [
    "catalog",
    "election",
    ...(d.bazaar.length ? ["bazaar"] : []),
    ...(needsAuctions ? ["auctions"] : []),
  ];
}
/** A single shared collector retains CAS leases, request charging and backoff. */
export async function collectPortfolioDemand(
  collector: MarketCollector,
  demand: Demand,
  enabled = PORTFOLIO_COLLECTION_ENABLED,
) {
  if (!enabled) return { paused: true, jobs: [] };
  const jobs = demandJobs(demand, collector.now());
  if (jobs.length) await collector.tick(jobs);
  return { paused: false, jobs };
}
