import { isFresh, isValidSample } from "../market";
import { auctionFees, verifiedSnapshotFees } from "./fees";
import type { AuctionOpportunity } from "./types";

/** Display a saved comparison without making stale listings eligible for actions. */
export function auctionComparison(
  o: AuctionOpportunity,
  duration = 24,
  now = Date.now(),
) {
  const sample = o.sampledValuation;
  if (
    (o.valuation.estimate !== null && o.profit !== null) ||
    !sample ||
    sample.basis !== "active-listings" ||
    (sample.estimate !== null &&
      (!Number.isFinite(sample.estimate) ||
        sample.estimate <= 0 ||
        sample.count < 1 ||
        sample.match !== "exact")) ||
    !o.listing.variant.complete ||
    !isValidSample(o.listing.upstreamAt, now) ||
    !isValidSample(o.listing.observedAt, now) ||
    !isFresh(o.listing.upstreamAt, o.listing.observedAt) ||
    sample.windowStart !== o.listing.upstreamAt ||
    sample.windowEnd !== o.listing.observedAt
  ) {
    return { ...o, sampled: false };
  }
  const fee = o.feeContext;
  const feeReady = verifiedSnapshotFees(fee, o.listing.observedAt, now);
  const fees =
    feeReady && sample.estimate !== null
      ? auctionFees(sample.estimate, duration, fee!.multiplier!)
      : null;
  const capital = o.listing.price + (fees ? fees.listing + fees.duration : 0);
  const profit = fees ? sample.estimate! - o.listing.price - fees.total : null;
  return {
    ...o,
    valuation: sample,
    fees,
    capital,
    profit,
    roi: profit === null ? null : (profit / capital) * 100,
    flags: [
      ...o.flags.filter(
        (f) => f !== "Current mayor taxes are unverified; profit withheld.",
      ),
      ...(!feeReady
        ? [
            "Taxes were not verified for this snapshot; after-fee gap unavailable.",
          ]
        : []),
    ],
    sampled: true,
  };
}
