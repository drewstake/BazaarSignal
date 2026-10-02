import {
  auctionOpportunity,
  confidenceRank,
  defaultAuctionFilters,
  matchesAuction,
  quantile,
} from "./auctions";
import type { AuctionFilters, FeeContext, Listing, Valuation } from "./types";

export function currentListing(l: Listing, now: number) {
  return (
    l.status === "active" &&
    l.end > now &&
    l.upstreamAt <= now + 30000 &&
    now - l.upstreamAt <= 180000 &&
    Number.isFinite(l.price) &&
    l.price > 0
  );
}

// Arithmetic mean of fresh exact-configuration asks. The candidate is excluded
// so a bargain cannot reduce its own comparison price. No sales history is read.
export function valueActiveListings(
  candidate: Listing,
  all: Listing[],
  now: number,
): Valuation {
  const matches = [
    ...new Map(
      all
        .filter(
          (l) =>
            l.id !== candidate.id &&
            currentListing(l, now) &&
            l.variant.complete &&
            l.variant.fingerprint === candidate.variant.fingerprint,
        )
        .map((l) => [l.id, l]),
    ).values(),
  ].sort((a, b) => a.price - b.price);
  const valid = candidate.variant.complete && currentListing(candidate, now);
  const prices = valid ? matches.map((l) => l.price) : [];
  const count = prices.length,
    median = count ? quantile(prices, 0.5) : null;
  const low = count ? quantile(prices, 0.25) : null,
    high = count ? quantile(prices, 0.75) : null;
  const dispersion = median ? (high! - low!) / median : null;
  const sellers = new Set(matches.map((l) => l.seller).filter(Boolean));
  const concentrated = sellers.size > 0 && sellers.size < Math.min(3, count);
  const average = count ? prices.reduce((sum, p) => sum + p, 0) / count : null;
  const skewed =
    median !== null &&
    average !== null &&
    (average > median * 1.5 || prices[count - 1] > median * 3);
  return {
    basis: "active-listings",
    estimate: average,
    median,
    low,
    high,
    trimmedMean: null,
    dispersion,
    movement: null,
    confidence: !count
      ? "insufficient"
      : count < 3 || (dispersion ?? 0) > 0.25 || concentrated || skewed
        ? "low"
        : count >= 12
          ? "high"
          : "medium",
    count,
    rawCount: matches.length,
    excludedCount: 0,
    windowStart: candidate.upstreamAt,
    windowEnd: now,
    sales: [],
    listings: valid
      ? matches.slice(0, 12).map(({ id, price, end }) => ({ id, price, end }))
      : [],
    match: count ? "exact" : "none",
    reasons: [
      !valid
        ? "Stale listing or incomplete configuration; comparison unavailable."
        : count
          ? "Arithmetic average of other active BIN listings with the same configuration and stack quantity."
          : "No other fresh exact-configuration BIN listings.",
      "Asking prices are not completed sales. The after-fee difference is hypothetical, not guaranteed profit.",
      ...(count < 3 && count > 0
        ? ["Few comparable listings; the average can be misleading."]
        : []),
      ...((dispersion ?? 0) > 0.25 || skewed
        ? [
            "Asking prices vary widely; expensive listings can inflate the average.",
          ]
        : []),
      ...(concentrated
        ? ["Comparable listings are concentrated among few sellers."]
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
  return auctionOpportunity(
    l,
    [],
    [],
    now,
    duration,
    false,
    valueActiveListings(l, all, now),
    fees,
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
  const groups = new Map<string, Listing[]>();
  const stale = all.length > 0 && now - all[0].upstreamAt > 180000;
  for (const l of all)
    if (currentListing(l, now) || stale) {
      const key = l.variant.fingerprint;
      if (!groups.has(key)) groups.set(key, []);
      groups
        .get(key)!
        .push(stale ? { ...l, status: l.end <= now ? "expired" : "stale" } : l);
    }
  const items = [...groups.values()]
    .flatMap((group) =>
      group.map((l) => activeOpportunity(l, group, now, f.durationHours, fees)),
    )
    .filter((o) =>
      matchesAuction(
        o,
        stale ? { ...f, showInsufficient: true, hideFlagged: false } : f,
        now,
      ),
    );
  const score = (o: (typeof items)[number]) =>
    f.sort === "roi"
      ? (o.roi ?? -Infinity)
      : f.sort === "capital"
        ? -o.listing.price
        : f.sort === "recent"
          ? o.listing.start
          : f.sort === "confidence"
            ? confidenceRank[o.valuation.confidence]
            : (o.profit ?? -Infinity);
  items.sort(
    (a, b) => score(b) - score(a) || a.listing.id.localeCompare(b.listing.id),
  );
  return {
    items: items.slice(page * 6, page * 6 + 6),
    total: items.length,
    page,
  };
}
