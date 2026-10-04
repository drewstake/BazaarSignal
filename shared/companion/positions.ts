import { isFresh, parseLevels } from "../market";
import { executeDepth, validBazaarSample } from "./bazaar";
import { bazaarTax, DEFAULT_BAZAAR_TAX, verifiedSnapshotFees } from "./fees";
import type { BazaarItem } from "./types";

// Keep these bounds in sync with firestore.rules. Only holdings are persisted.
export const MAX_POSITION_QUANTITY = 1_000_000_000;
export const MAX_POSITION_COST = 1_000_000_000_000_000;
export interface Position {
  itemId: string;
  name: string;
  quantity: number;
  costBasis: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export type CostMode = "average" | "total";
const decimal = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
export function parseCoinAmount(input: string): number | null {
  const match = input.trim().match(/^(.*?)([kmb])?$/i);
  if (!match || !decimal.test(match[1])) return null;
  const value =
    Number(match[1].replaceAll(",", "")) *
    ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() ?? ""] ?? 1);
  return Number.isFinite(value) && value > 0 && value <= MAX_POSITION_COST
    ? value
    : null;
}
export function parsePositionQuantity(input: string): number | null {
  const text = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
  const value = Number(text.replaceAll(",", ""));
  return Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_POSITION_QUANTITY
    ? value
    : null;
}
export function validHolding(quantity: number, costBasis: number) {
  return (
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    quantity <= MAX_POSITION_QUANTITY &&
    Number.isFinite(costBasis) &&
    costBasis >= 0.01 &&
    costBasis <= MAX_POSITION_COST
  );
}
export function positionInput(
  quantityText: string,
  costText: string,
  mode: CostMode,
) {
  const quantity = parsePositionQuantity(quantityText),
    amount = parseCoinAmount(costText);
  if (quantity === null)
    return {
      error: "Enter a whole quantity from 1 to 1,000,000,000.",
    } as const;
  if (amount === null)
    return {
      error:
        "Enter a positive coin amount, such as 12.2m or 3.5b (up to 1,000,000,000,000,000).",
    } as const;
  const costBasis = mode === "average" ? quantity * amount : amount;
  if (!validHolding(quantity, costBasis))
    return {
      error:
        "Total cost basis must be between 0.01 and 1,000,000,000,000,000 coins.",
    } as const;
  return { quantity, costBasis, averagePrice: costBasis / quantity } as const;
}
export function quantityFromCostInput(averageText: string, totalText: string) {
  const average = parseCoinAmount(averageText),
    total = parseCoinAmount(totalText);
  if (average === null || total === null)
    return {
      error:
        "Enter a positive average purchase price and total coins spent, such as 12.2m or 3.5b.",
    } as const;
  const calculated = total / average;
  if (
    !Number.isFinite(calculated) ||
    calculated < 1 ||
    calculated > MAX_POSITION_QUANTITY
  )
    return {
      error:
        "Calculated quantity must be from 1 to 1,000,000,000. Check the average price and total spent.",
    } as const;
  const quantity = Math.round(calculated),
    input = positionInput(String(quantity), totalText, "total");
  if (input.error) return input;
  return {
    ...input,
    rounded: Math.abs(calculated - quantity) > Number.EPSILON * calculated * 4,
  } as const;
}
export function addPurchase(
  current: Pick<Position, "quantity" | "costBasis">,
  purchase: Pick<Position, "quantity" | "costBasis">,
) {
  const quantity = current.quantity + purchase.quantity,
    costBasis = current.costBasis + purchase.costBasis;
  if (
    !validHolding(current.quantity, current.costBasis) ||
    !validHolding(purchase.quantity, purchase.costBasis) ||
    !validHolding(quantity, costBasis)
  )
    throw new Error(
      "Combined holdings exceed the quantity or cost basis limits.",
    );
  return { quantity, costBasis };
}
export function validPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const p = value as Position;
  return (
    Object.keys(p).length === 7 &&
    typeof p.itemId === "string" &&
    /^[A-Za-z0-9_:-]{1,100}$/.test(p.itemId) &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    p.name.length <= 140 &&
    validHolding(p.quantity, p.costBasis) &&
    Number.isSafeInteger(p.createdAt) &&
    p.createdAt > 0 &&
    Number.isSafeInteger(p.updatedAt) &&
    p.updatedAt >= p.createdAt &&
    Number.isSafeInteger(p.revision) &&
    p.revision >= 1 &&
    p.revision <= 1e9
  );
}

export function valuePosition(
  position: Position,
  item: BazaarItem | undefined,
  now = Date.now(),
  lastKnown = false,
) {
  const unavailable = {
    referencePrice: null,
    value: null,
    pnl: null,
    returnPercent: null,
    sampledAt: null,
    freshness: "unavailable",
    liquidation: null,
    liquidationReason: "No usable instant-sell bid sample.",
  } as const;
  if (
    !validHolding(position.quantity, position.costBasis) ||
    !item ||
    item.id !== position.itemId ||
    !validBazaarSample(item, now)
  )
    return unavailable;
  // Normalized bids are sell_summary: highest bids first, never asks/instant-buy.
  let bids: ReturnType<typeof parseLevels>;
  try {
    bids = parseLevels(item.bids).sort((a, b) => b.pricePerUnit - a.pricePerUnit);
  } catch {
    return unavailable;
  }
  const top = executeDepth(bids.slice(0, 1), 1);
  if (!top) return unavailable;
  const value = position.quantity * top.unit;
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER)
    return unavailable;
  const pnl = value - position.costBasis;
  const sale = executeDepth(bids, position.quantity);
  const feeReady = verifiedSnapshotFees(item.feeContext, item.observedAt, now);
  const taxPercent = feeReady
    ? DEFAULT_BAZAAR_TAX * item.feeContext!.multiplier!
    : null;
  const net =
    sale && taxPercent !== null
      ? sale.total - bazaarTax(sale.total, taxPercent)
      : null;
  return {
    referencePrice: top.unit,
    value,
    pnl,
    returnPercent: (pnl / position.costBasis) * 100,
    sampledAt: item.upstreamAt,
    freshness: lastKnown || !isFresh(item.upstreamAt, now) ? "stale" : "fresh",
    liquidation:
      net === null
        ? null
        : {
            value: net,
            pnl: net - position.costBasis,
            returnPercent:
              ((net - position.costBasis) / position.costBasis) * 100,
            taxPercent: taxPercent!,
            tax: sale!.total - net,
            gross: sale!.total,
          },
    liquidationReason: !sale
      ? "Insufficient or invalid visible bid depth for the entire quantity."
      : !feeReady
        ? "Compatible fee evidence is unavailable for this sample."
        : null,
  };
}
export function positionPortfolio(
  positions: Position[],
  items: BazaarItem[],
  now = Date.now(),
  lastKnown = false,
) {
  const market = new Map(items.map((item) => [item.id, item]));
  const rows = positions.map((position) => ({
    position,
    valuation: valuePosition(
      position,
      market.get(position.itemId),
      now,
      lastKnown,
    ),
  }));
  const valued = rows.filter((row) => row.valuation.value !== null);
  const costBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
  const valuedBasis = valued.reduce(
    (sum, row) => sum + row.position.costBasis,
    0,
  );
  const value = valued.length
    ? valued.reduce((sum, row) => sum + row.valuation.value!, 0)
    : null;
  const pnl = value === null ? null : value - valuedBasis;
  return {
    rows,
    costBasis,
    valuedBasis,
    value,
    pnl,
    returnPercent: pnl === null ? null : (pnl / valuedBasis) * 100,
    missing: rows.length - valued.length,
    stale: valued.some((row) => row.valuation.freshness === "stale"),
  };
}
