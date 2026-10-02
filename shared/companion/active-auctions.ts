import {
  auctionOpportunity,
  confidenceRank,
  defaultAuctionFilters,
  matchesAuction,
  quantile,
} from "./auctions";
import type {
  AuctionFilters,
  AuctionOpportunity,
  FeeContext,
  Listing,
  Valuation,
} from "./types";
import { isFresh, isValidSample } from "../market";
import { auctionComparison } from "./auction-comparison";

export function currentListing(l: Listing, now: number) {
  return (
    l.status === "active" &&
    l.end > now &&
    isFresh(l.upstreamAt, now) &&
    Number.isFinite(l.price) &&
    l.price > 0
  );
}

// Fingerprints include rarity, enchantments, every decoded upgrade and quantity.
// Explicit identity/quantity/rarity guards also reject malformed cached records.
export function exactConfiguration(a: Listing, b: Listing) {
  return (
    a.variant.complete &&
    b.variant.complete &&
    a.variant.fingerprint === b.variant.fingerprint &&
    a.variant.itemId === b.variant.itemId &&
    a.variant.quantity === b.variant.quantity &&
    a.variant.rarity === b.variant.rarity
  );
}

export function valueActiveListings(
  candidate: Listing,
  all: Listing[],
  now: number,
): Valuation {
  const valid = candidate.variant.complete && currentListing(candidate, now);
  const matches = valid
    ? [
        ...new Map(
          all
            .filter(
              (l) =>
                l.id !== candidate.id &&
                currentListing(l, now) &&
                l.upstreamAt === candidate.upstreamAt &&
                exactConfiguration(candidate, l),
            )
            .map((l) => [l.id, l]),
        ).values(),
      ].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
    : [];
  const raw = matches.map((l) => l.price);
  const median = raw.length ? quantile(raw, 0.5) : null;
  const mad =
    median === null
      ? 0
      : quantile(
          raw.map((p) => Math.abs(p - median)).sort((a, b) => a - b),
          0.5,
        );
  // Upper-tail only: removing a cheap competing ask could manufacture a gap.
  // Fewer than five peers cannot establish outliers reliably; keep and flag them.
  const ceiling =
    raw.length >= 5 ? median! + Math.max(6 * mad, median! * 0.5) : Infinity;
  const clean = matches.filter((l) => l.price <= ceiling);
  const prices = clean.map((l) => l.price),
    count = prices.length;
  const low = count ? quantile(prices, 0.25) : null;
  const high = count ? quantile(prices, 0.75) : null;
  const dispersion = median
    ? (quantile(raw, 0.75) - quantile(raw, 0.25)) / median
    : null;
  const arithmeticMean = raw.length
    ? raw.reduce((sum, p) => sum + p / raw.length, 0)
    : null;
  const sellers = new Map<string, number>();
  clean.forEach((l) => {
    if (l.seller) sellers.set(l.seller, (sellers.get(l.seller) ?? 0) + 1);
  });
  const largestSellerShare = count
    ? Math.max(0, ...sellers.values()) / count
    : 0;
  const unknownSellers = clean.some((l) => !l.seller);
  const concentrated =
    count > 0 &&
    (sellers.size < 3 ||
      largestSellerShare > 0.5 ||
      (!!candidate.seller && clean.some((l) => l.seller === candidate.seller)));
  const excludedCount = raw.length - count;
  const skewed =
    median !== null &&
    arithmeticMean !== null &&
    (arithmeticMean > median * 1.5 || raw[raw.length - 1] > median * 3);
  return {
    basis: "active-listings",
    estimate: count ? Math.min(low!, prices[0]) : null,
    arithmeticMean,
    median,
    low,
    high,
    trimmedMean: null,
    dispersion,
    movement: null,
    sellerCount: sellers.size,
    largestSellerShare,
    confidence: !count
      ? "insufficient"
      : count < 3 ||
          concentrated ||
          unknownSellers ||
          (dispersion ?? 0) > 0.25 ||
          excludedCount > 0 ||
          skewed
        ? "low"
        : count >= 12
          ? "high"
          : "medium",
    count,
    rawCount: matches.length,
    excludedCount,
    windowStart: candidate.upstreamAt,
    windowEnd: now,
    sales: [],
    listings: matches.map(({ id, price, end, seller, sellerName }) => ({
      id,
      price,
      end,
      seller,
      sellerName,
      ...(price > ceiling
        ? {
            excluded: `Upper outlier: ask exceeds ${Math.round(ceiling).toLocaleString("en-US")} coins (median + max(6 × MAD, 50% of median)).`,
          }
        : {}),
    })),
    match: count ? "exact" : "none",
    reasons: [
      !valid
        ? "Stale listing or incomplete configuration; comparison unavailable."
        : count
          ? "Conservative resale estimate: lower quartile of valid exact-configuration asks, capped by the lowest competing ask. The selected auction is excluded; stack quantities are never mixed."
          : "No other valid exact-configuration BIN listings in this snapshot; estimate unavailable.",
      "Asking prices are hypothetical comparisons, not completed sales or evidence of demand, sell-through or guaranteed profit.",
      ...(count > 0 && count < 3
        ? [
            "Fewer than 3 matching listings: low confidence. Sparse asks cannot establish a reliable market price or outliers.",
          ]
        : []),
      ...(excludedCount
        ? [
            `${excludedCount} upper-price outlier(s) excluded from the estimate, retained below for inspection. Cheap competing asks are never removed. Confidence reduced.`,
          ]
        : []),
      ...((dispersion ?? 0) > 0.25 || skewed
        ? [
            "Wide or skewed asking prices can inflate the arithmetic average; confidence reduced.",
          ]
        : []),
      ...(concentrated
        ? [
            "Few independent sellers, a seller controls over half the comparisons, or the purchase seller also appears in the pool; confidence reduced.",
          ]
        : []),
      ...(unknownSellers
        ? [
            "Some seller identities are unavailable; independence cannot be verified and confidence is reduced.",
          ]
        : []),
    ],
  };
}

export function activeOpportunity(
  l: Listing,
  all: Listing[],
  now: number,
  duration = 24,
  fees?: FeeContext,
) {
  const sampledValuation =
    isValidSample(l.observedAt, now) &&
    isValidSample(l.upstreamAt, now) &&
    isFresh(l.upstreamAt, l.observedAt)
      ? valueActiveListings(l, all, l.observedAt)
      : undefined;
  const listing = {
    ...l,
    status:
      l.status === "active" && l.end <= now
        ? ("expired" as const)
        : l.status === "active" && !isFresh(l.upstreamAt, now)
          ? ("stale" as const)
          : l.status,
  };
  return auctionOpportunity(
    listing,
    [],
    [],
    now,
    duration,
    false,
    valueActiveListings(l, all, now),
    fees,
    sampledValuation,
  );
}

/** Evidence quality first; monetary gaps only break ties within a support tier. */
export function supportedRank(o: ReturnType<typeof auctionComparison>) {
  if (o.profit === null || o.valuation.estimate === null) return 0;
  if (o.profit <= 0) return 1;
  return confidenceRank[o.valuation.confidence] >= 2 ? 3 : 2;
}
export function supportWeight(o: ReturnType<typeof auctionComparison>) {
  const v = o.valuation;
  return (
    ((Math.min(1, v.count / 5) *
      Math.min(1, (v.sellerCount ?? 0) / 3) *
      (1 - (v.largestSellerShare ?? 1))) /
      (1 + (v.dispersion ?? 1))) *
    (v.excludedCount ? 0.25 : 1)
  );
}

export function activePage(
  all: Listing[],
  input: Partial<AuctionFilters>,
  page: number,
  now: number,
  fees?: FeeContext,
) {
  const f = { ...defaultAuctionFilters, ...input };
  const canonical = new Map<string, Listing[]>(),
    configs = new Map<string, Listing[]>();
  // Deduplicate the whole cached pool before filters and before item pagination.
  for (const l of new Map(all.map((l) => [l.id, l])).values()) {
    if (!l.variant.itemId) continue;
    if (!canonical.has(l.variant.itemId)) canonical.set(l.variant.itemId, []);
    canonical.get(l.variant.itemId)!.push(l);
    if (!configs.has(l.variant.fingerprint))
      configs.set(l.variant.fingerprint, []);
    configs.get(l.variant.fingerprint)!.push(l);
  }
  const items: AuctionOpportunity[] = [];
  for (const pool of canonical.values()) {
    const matchingListings: Listing[] = [];
    let representative: AuctionOpportunity | undefined;
    for (const l of pool) {
      // Keep historical active snapshots browseable without reviving sold/unavailable records.
      if (
        !currentListing(l, now) &&
        !(
          isValidSample(l.observedAt, now) &&
          isValidSample(l.upstreamAt, now) &&
          isFresh(l.upstreamAt, l.observedAt) &&
          currentListing(l, l.observedAt)
        )
      )
        continue;
      const o = activeOpportunity(
        l,
        configs.get(l.variant.fingerprint)!,
        now,
        f.durationHours,
        fees,
      );
      if (!matchesAuction(auctionComparison(o, f.durationHours, now), f, now))
        continue;
      matchingListings.push(l);
      if (
        !representative ||
        l.price < representative.listing.price ||
        (l.price === representative.listing.price &&
          l.id < representative.listing.id)
      )
        representative = o;
    }
    if (representative)
      items.push({
        ...representative,
        group: { matchingListings, comparisonPool: pool },
      });
  }
  const comparison = new Map(
    items.map((o) => [o, auctionComparison(o, f.durationHours, now)]),
  );
  const score = (item: AuctionOpportunity) => {
    const o = comparison.get(item)!;
    return f.sort === "roi"
      ? (o.roi ?? -Infinity)
      : f.sort === "capital"
        ? -o.listing.price
        : f.sort === "recent"
          ? o.listing.start
          : f.sort === "confidence"
            ? confidenceRank[o.valuation.confidence]
            : f.sort === "profit"
              ? (o.profit ?? -Infinity)
              : (o.profit ?? 0) * supportWeight(o);
  };
  items.sort(
    (a, b) =>
      (f.sort === "supported"
        ? supportedRank(comparison.get(b)!) - supportedRank(comparison.get(a)!)
        : 0) ||
      score(b) - score(a) ||
      a.listing.variant.itemId.localeCompare(b.listing.variant.itemId),
  );
  const safePage = Math.max(
    0,
    Math.min(
      Number.isSafeInteger(page) ? page : 0,
      Math.max(0, Math.ceil(items.length / 6) - 1),
    ),
  );
  return {
    items: items.slice(safePage * 6, safePage * 6 + 6),
    total: items.length,
    page: safePage,
  };
}
