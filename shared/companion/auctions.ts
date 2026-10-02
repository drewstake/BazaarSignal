import { auctionFees, verifiedSnapshotFees } from "./fees";
import type {
  AuctionFilters,
  AuctionOpportunity,
  Confidence,
  FeeContext,
  ItemVariant,
  Listing,
  Sale,
  Valuation,
} from "./types";

export const defaultAuctionFilters: AuctionFilters = {
  query: "",
  category: "all",
  rarity: "all",
  budget: 10_000_000,
  minProfit: 0,
  minRoi: 0,
  minComps: 1,
  confidence: "low",
  requiredEnchant: "",
  excludedEnchant: "",
  enchantLevel: 1,
  upgrade: "",
  maxAgeMinutes: 1440,
  hideFlagged: false,
  showInsufficient: true,
  durationHours: 24,
  sort: "supported",
  view: "cards",
};
export const confidenceRank: Record<Confidence, number> = {
  insufficient: 0,
  low: 1,
  medium: 2,
  high: 3,
};
export function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export interface ConfigurationRule {
  id: string;
  itemIds: string[];
  enchantment: string;
  minLevel: number;
  kind: "mechanical" | "preference";
  explanation: string;
  source: string;
}
// Empty until an item-specific rule has evidence. More enchants are not a premium.
export const configurationRules: ConfigurationRule[] = [];
export function configurationFlags(v: ItemVariant, rules = configurationRules) {
  return rules
    .filter(
      (r) =>
        r.itemIds.includes(v.itemId) &&
        (v.enchantments[r.enchantment] ?? 0) >= r.minLevel,
    )
    .map(
      (r) =>
        `${r.kind === "mechanical" ? "Documented mechanics" : "Market preference"}: ${r.explanation} (${r.source})`,
    );
}
export function valueVariant(
  variant: ItemVariant,
  history: Sale[],
  competing: Listing[],
  now: number,
  hasGaps = false,
): Valuation {
  const windowStart = now - 14 * 86400_000;
  const raw = [
    ...new Map(
      history
        .filter(
          (s) =>
            s.variant.complete &&
            s.variant.fingerprint === variant.fingerprint &&
            s.source === "hypixel-ended" &&
            Number.isFinite(s.price) &&
            s.price > 0 &&
            s.soldAt >= windowStart &&
            s.soldAt <= now &&
            s.buyer &&
            s.seller &&
            s.buyer !== s.seller,
        )
        .map((s) => [s.id, s]),
    ).values(),
  ].sort((a, b) => b.soldAt - a.soldAt);
  const empty: Valuation = {
    confidence: "insufficient",
    reasons: [],
    estimate: null,
    low: null,
    high: null,
    median: null,
    trimmedMean: null,
    dispersion: null,
    movement: null,
    count: 0,
    rawCount: raw.length,
    excludedCount: raw.length,
    windowStart,
    windowEnd: now,
    sales: [],
    match: raw.length ? "exact" : "none",
  };
  if (!variant.complete)
    return {
      ...empty,
      reasons: [
        "Incomplete configuration decoding; valuation withheld.",
        ...variant.issues,
      ],
    };
  // Bound each seller and buyer's influence. This is a concentration guard, not
  // proof of manipulation or knowledge of related accounts.
  const sellers = new Map<string, number>(),
    buyers = new Map<string, number>();
  const independent = raw.filter((s) => {
    if ((sellers.get(s.seller) ?? 0) >= 2 || (buyers.get(s.buyer) ?? 0) >= 2)
      return false;
    sellers.set(s.seller, (sellers.get(s.seller) ?? 0) + 1);
    buyers.set(s.buyer, (buyers.get(s.buyer) ?? 0) + 1);
    return true;
  });
  if (!independent.length)
    return {
      ...empty,
      reasons: [
        "Collecting price history: no verified exact-configuration sales.",
      ],
    };
  const values = independent.map((s) => s.price).sort((a, b) => a - b),
    median = quantile(values, 0.5);
  const deviations = values
      .map((v) => Math.abs(v - median))
      .sort((a, b) => a - b),
    mad = quantile(deviations, 0.5);
  const tolerance = Math.max(6 * mad, median * 0.15);
  const clean = independent.filter(
    (s) => values.length < 5 || Math.abs(s.price - median) <= tolerance,
  );
  const prices = clean.map((s) => s.price).sort((a, b) => a - b),
    count = prices.length;
  if (!count)
    return {
      ...empty,
      reasons: ["Not enough comparable sales after outlier checks."],
    };
  const med = quantile(prices, 0.5),
    low = quantile(prices, 0.25),
    high = quantile(prices, 0.75),
    dispersion = (high - low) / med;
  const trim = count >= 10 ? Math.floor(count * 0.1) : 0,
    trimmed = prices.slice(trim, count - trim);
  const recent = clean
    .filter((s) => now - s.soldAt <= 3 * 86400_000)
    .map((s) => s.price)
    .sort((a, b) => a - b);
  const older = clean
    .filter((s) => now - s.soldAt > 3 * 86400_000)
    .map((s) => s.price)
    .sort((a, b) => a - b);
  const movement =
    recent.length >= 3 && older.length >= 3
      ? (quantile(recent, 0.5) / quantile(older, 0.5) - 1) * 100
      : null;
  const reasons = [
    "Exact fingerprint matches only; no enchantment retail-price premiums.",
    "Conservative resale uses the lower quartile, recent evidence, and the lowest competing exact BIN ask.",
  ];
  if (raw.length > clean.length)
    reasons.push(
      `${raw.length - clean.length} observations excluded by participant limits or robust outlier checks.`,
    );
  if (hasGaps)
    reasons.push(
      "Collection has known gaps; these are observed sales, not complete market coverage.",
    );
  if (dispersion > 0.25) reasons.push("Comparable prices vary widely.");
  if (count < 5)
    reasons.push(
      "Not enough comparable sales: at least 5 independent observations are needed for a resale estimate.",
    );
  if (recent.length < 3)
    reasons.push("Fewer than 3 comparable sales in the last 72 hours.");
  const concentrated = raw.length > 0 && independent.length / raw.length < 0.5;
  if (concentrated)
    reasons.push(
      "Activity is concentrated in a small group of participants; confidence reduced.",
    );
  let confidence: Confidence =
    count < 5
      ? "insufficient"
      : recent.length < 3 || dispersion > 0.25 || concentrated
        ? "low"
        : count >= 12 && !hasGaps && dispersion < 0.15
          ? "high"
          : "medium";
  const asks = competing
    .filter(
      (l) =>
        l.variant.fingerprint === variant.fingerprint &&
        l.status === "active" &&
        l.end > now &&
        l.upstreamAt <= now + 30000 &&
        now - l.upstreamAt <= 180000,
    )
    .map((l) => l.price);
  const estimate =
    count < 5
      ? null
      : Math.min(
          low,
          recent.length >= 3 ? quantile(recent, 0.25) : low,
          ...asks,
        );
  return {
    ...empty,
    confidence,
    reasons,
    estimate,
    low,
    high,
    median: med,
    trimmedMean: trimmed.reduce((n, p) => n + p, 0) / trimmed.length,
    dispersion,
    movement,
    count,
    excludedCount: raw.length - count,
    sales: clean
      .slice(0, 12)
      .map(({ id, price, soldAt }) => ({ id, price, soldAt })),
  };
}
export function auctionOpportunity(
  listing: Listing,
  history: Sale[],
  competing: Listing[],
  now: number,
  durationHours = 24,
  hasGaps = false,
  precomputed?: Valuation,
  feeContext?: FeeContext,
  sampledValuation?: Valuation,
): AuctionOpportunity {
  let valuation =
    precomputed ??
    valueVariant(
      listing.variant,
      history,
      competing.filter((l) => l.id !== listing.id),
      now,
      hasGaps,
    );
  if (
    valuation.basis === "active-listings" &&
    (listing.status !== "active" ||
      listing.end <= now ||
      now - listing.upstreamAt > 180000 ||
      listing.upstreamAt > now + 30000)
  ) {
    valuation = {
      ...valuation,
      estimate: null,
      median: null,
      low: null,
      high: null,
      trimmedMean: null,
      dispersion: null,
      movement: null,
      count: 0,
      rawCount: 0,
      match: "none",
      listings: [],
      confidence: "insufficient",
      reasons: [
        "Listing is stale or unavailable. Waiting for automatic updates.",
      ],
    };
  }
  const feeReady =
    valuation.basis === "active-listings"
      ? verifiedSnapshotFees(feeContext, listing.observedAt, now)
      : !feeContext || verifiedSnapshotFees(feeContext, listing.observedAt, now);
  const fees =
    valuation.estimate === null || !feeReady
      ? null
      : auctionFees(
          valuation.estimate,
          durationHours,
          feeContext?.multiplier ?? 1,
        );
  const capital = listing.price + (fees ? fees.listing + fees.duration : 0);
  const profit = fees ? valuation.estimate! - listing.price - fees.total : null;
  return {
    listing,
    valuation,
    ...(sampledValuation ? { sampledValuation } : {}),
    fees,
    capital,
    profit,
    roi: profit === null ? null : (profit / capital) * 100,
    ...(feeContext ? { feeContext } : {}),
    flags: [
      ...listing.variant.issues,
      ...configurationFlags(listing.variant),
      ...(!feeReady
        ? ["Current mayor taxes are unverified; profit withheld."]
        : []),
    ],
  };
}
export function matchesAuction(
  o: AuctionOpportunity,
  f: AuctionFilters,
  now: number,
) {
  const v = o.listing.variant,
    ench = v.enchantments;
  const required = f.requiredEnchant.trim().toLowerCase().replaceAll(" ", "_"),
    excluded = f.excludedEnchant.trim().toLowerCase().replaceAll(" ", "_");
  if (
    !`${v.name} ${v.itemId}`
      .toLowerCase()
      .includes(f.query.trim().toLowerCase()) ||
    (f.category !== "all" && v.category !== f.category) ||
    (f.rarity !== "all" && v.rarity !== f.rarity) ||
    o.listing.price > f.budget ||
    now - o.listing.start > f.maxAgeMinutes * 60000 ||
    (required && !(ench[required] >= f.enchantLevel)) ||
    (excluded && (ench[excluded] ?? 0) >= f.enchantLevel) ||
    (f.upgrade &&
      !JSON.stringify(v.modifiers)
        .toLowerCase()
        .includes(f.upgrade.toLowerCase())) ||
    (f.hideFlagged && o.flags.length)
  )
    return false;
  if (o.valuation.estimate === null || o.profit === null)
    return f.showInsufficient;
  return (
    o.valuation.count >= f.minComps &&
    confidenceRank[o.valuation.confidence] >= confidenceRank[f.confidence] &&
    o.profit! >= f.minProfit &&
    o.roi! >= f.minRoi
  );
}
