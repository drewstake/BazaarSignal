// Versioned assumptions, independently documented in docs/MARKET.md. Never infer a
// player's perks from public market data. The UI exposes the Bazaar rate explicitly.
import type { FeeContext } from "./types";
import { isValidSample } from "../market";

export function verifiedSnapshotFees(
  fee: FeeContext | undefined,
  observedAt: number,
  now: number,
) {
  return (
    !!fee &&
    isValidSample(fee.checkedAt, now) &&
    isValidSample(observedAt, now) &&
    Math.abs(observedAt - fee.checkedAt) < 600_000 &&
    fee.multiplier !== null &&
    Number.isFinite(fee.multiplier) &&
    fee.multiplier >= 1 &&
    fee.multiplier <= 10
  );
}
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
