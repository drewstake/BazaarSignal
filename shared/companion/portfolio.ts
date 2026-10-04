import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { validPosition, valuePosition, type Position } from "./positions";
import type { BazaarItem, ItemVariant, Json } from "./types";

export interface Portfolio {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  deleted: boolean;
}
// Legacy auction records remain readable/deletable, but cannot be priced or monitored.
export interface Asset {
  kind: "bazaar" | "auction";
  configuration: string;
  stackSize: number;
}
export interface Holding extends Position, Asset {
  id: string;
  deleted: boolean;
}
export const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_:-]{1,100}$/.test(id);
const exactKeys = (v: object, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
export function validPortfolio(value: unknown): value is Portfolio {
  const p = value as Portfolio;
  return (
    !!p &&
    exactKeys(p, [
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "revision",
      "deleted",
    ]) &&
    validId(p.id) &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    p.name.length <= 80 &&
    Number.isSafeInteger(p.createdAt) &&
    p.createdAt > 0 &&
    Number.isSafeInteger(p.updatedAt) &&
    p.updatedAt >= p.createdAt &&
    Number.isSafeInteger(p.revision) &&
    p.revision > 0 &&
    p.revision <= 1e9 &&
    typeof p.deleted === "boolean"
  );
}
function canonical(v: unknown): Json {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  throw new Error("Invalid asset configuration.");
}
// Apps Script V8 has no browser TextEncoder. Use the same UTF-8 bytes on every
// runtime so manually defined configurations match the collector fingerprints.
function utf8(text: string) {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 128) bytes.push(cp);
    else if (cp < 2048) bytes.push(192 | (cp >> 6), 128 | (cp & 63));
    else if (cp < 65536)
      bytes.push(224 | (cp >> 12), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
    else
      bytes.push(
        240 | (cp >> 18),
        128 | ((cp >> 12) & 63),
        128 | ((cp >> 6) & 63),
        128 | (cp & 63),
      );
  }
  return Uint8Array.from(bytes);
}
/** Compatibility validation for saved records only. Not a supported market asset. */
export function auctionVariant(
  itemId: string,
  name: string,
  stackSize: number,
  configuration: string,
): ItemVariant {
  if (
    !validId(itemId) ||
    !Number.isSafeInteger(stackSize) ||
    stackSize < 1 ||
    stackSize > 127 ||
    configuration.length > 8192
  )
    throw new Error("Invalid auction asset.");
  const input = JSON.parse(configuration);
  if (
    !input ||
    !exactKeys(input, ["rarity", "enchantments", "modifiers"]) ||
    ![
      "COMMON",
      "UNCOMMON",
      "RARE",
      "EPIC",
      "LEGENDARY",
      "MYTHIC",
      "DIVINE",
      "SPECIAL",
      "VERY_SPECIAL",
    ].includes(input.rarity) ||
    !input.enchantments ||
    Array.isArray(input.enchantments) ||
    typeof input.enchantments !== "object" ||
    !input.modifiers ||
    Array.isArray(input.modifiers) ||
    typeof input.modifiers !== "object" ||
    Object.values(input.enchantments).some(
      (v) => !Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 255,
    )
  )
    throw new Error(
      "Specify rarity, enchantments and modifiers for this exact variant.",
    );
  const config = {
    version: 1,
    itemId,
    quantity: stackSize,
    rarity: input.rarity,
    enchantments: input.enchantments,
    modifiers: input.modifiers,
  };
  return {
    ...config,
    version: 1,
    name,
    category: "other",
    fingerprint: `v1_${bytesToHex(sha256(utf8(JSON.stringify(canonical(config)))))}`,
    complete: true,
    issues: [],
  };
}
export function assetId(itemId: string, asset: Asset) {
  return asset.kind === "bazaar"
    ? `bz_${itemId}`
    : auctionVariant(itemId, "", asset.stackSize, asset.configuration)
        .fingerprint;
}
export function validPortfolioHolding(value: unknown): value is Holding {
  if (!value || typeof value !== "object") return false;
  const { id, kind, configuration, stackSize, deleted, ...position } =
    value as Holding;
  if (
    !validPosition(position) ||
    typeof deleted !== "boolean" ||
    !["bazaar", "auction"].includes(kind) ||
    typeof configuration !== "string"
  )
    return false;
  try {
    return (
      id === assetId(position.itemId, { kind, configuration, stackSize }) &&
      (kind !== "bazaar" || (configuration === "" && stackSize === 1))
    );
  } catch {
    return false;
  }
}
export const legacyHolding = (p: Position): Holding => ({
  ...p,
  id: `bz_${p.itemId}`,
  kind: "bazaar",
  configuration: "",
  stackSize: 1,
  deleted: false,
});
export interface HoldingValue {
  referencePrice: number | null;
  value: number | null;
  pnl: number | null;
  returnPercent: number | null;
  sampledAt: number | null;
  freshness: string;
  source: string;
  reference: string;
  liquidation: ReturnType<typeof valuePosition>["liquidation"];
  liquidationReason: string | null;
  comparables: number | null;
  uncertainty: string[];
}
export function valueHolding(
  holding: Holding,
  bazaar: BazaarItem[],
  retiredListings: unknown[],
  now = Date.now(),
  lastKnown = false,
): HoldingValue {
  if (holding.kind === "bazaar")
    return {
      ...valuePosition(
        holding,
        bazaar.find((b) => b.id === holding.itemId),
        now,
        lastKnown,
      ),
      source: "bazaar-bid-v1",
      reference: "Highest instant-sell bid · before selling fees and slippage",
      comparables: null,
      uncertainty: [],
    };
  return {
    referencePrice: null,
    value: null,
    pnl: null,
    returnPercent: null,
    sampledAt: null,
    freshness: "unavailable",
    source: "unsupported-asset",
    reference: "This saved asset is no longer supported.",
    liquidation: null,
    liquidationReason: "Only Bazaar holdings receive price updates.",
    comparables: null,
    uncertainty: [],
  };
}
export function portfolioTotals(
  holdings: Holding[],
  bazaar: BazaarItem[],
  retiredListings: unknown[],
  now = Date.now(),
  lastKnown = false,
) {
  const rows = holdings
    .filter((h) => !h.deleted)
    .map((holding) => ({
      holding,
      valuation: valueHolding(holding, bazaar, retiredListings, now, lastKnown),
    }));
  const priced = rows.filter((r) => r.valuation.value !== null);
  const costBasis = rows.reduce((sum, r) => sum + r.holding.costBasis, 0),
    valuedBasis = priced.reduce((sum, r) => sum + r.holding.costBasis, 0);
  const value = priced.length
    ? priced.reduce((sum, r) => sum + r.valuation.value!, 0)
    : null;
  const pnl = value === null ? null : value - valuedBasis;
  return {
    rows,
    costBasis,
    valuedBasis,
    value,
    pnl,
    returnPercent: pnl === null ? null : (pnl / valuedBasis) * 100,
    missing: rows.length - priced.length,
    stale: priced.some((r) => r.valuation.freshness === "stale"),
  };
}
