import type { Listing, Valuation } from "./types";
import { isFresh } from "../market";
import { quantile } from "./auctions";

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
