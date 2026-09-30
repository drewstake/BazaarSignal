// Versioned assumptions, independently documented in docs/MARKET.md. Never infer a
// player's perks from public market data. The UI exposes the Bazaar rate explicitly.
export const FEE_MODEL_VERSION = "2026-09-30";
export const BAZAAR_TAX_PRESETS = [1.25, 1.125, 1] as const;
export const DEFAULT_BAZAAR_TAX = 1.25;
export function bazaarTax(gross: number, percent = DEFAULT_BAZAAR_TAX) {
  if (
    !Number.isFinite(gross) ||
    gross < 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    throw new Error("Invalid fee inputs");
  return (gross * percent) / 100;
}
export function auctionFees(price: number, hours = 24, multiplier = 1) {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    ![1, 6, 12, 24, 48].includes(hours) ||
    !Number.isFinite(multiplier) ||
    multiplier < 1 ||
    multiplier > 10
  )
    throw new Error("Invalid auction fee inputs");
  // BIN brackets apply to the full asking price, not marginal slices.
  const listing =
    price *
    (price > 100_000_000 ? 0.025 : price >= 10_000_000 ? 0.02 : 0.01) *
    multiplier;
  const duration =
    ({ 1: 20, 6: 45, 12: 100, 24: 350, 48: 1200 } as Record<number, number>)[
      hours
    ] * multiplier;
  // The collection tax cannot bring the payout below the 1M threshold.
  const claim =
    price > 1_000_000
      ? Math.min(price * 0.01 * multiplier, price - 1_000_000)
      : 0;
  return { listing, duration, claim, total: listing + duration + claim };
}
