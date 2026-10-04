import type { Level } from "../model";
export type Confidence = "insufficient" | "low" | "medium" | "high";
export interface FeeContext {
  mayor: string;
  multiplier: number | null;
  checkedAt: number;
  explanation: string;
}
export interface BazaarItem {
  id: string;
  name: string;
  category: string;
  rarity: string;
  asks: Level[];
  bids: Level[];
  openSellQuantity: number | null;
  openBuyQuantity: number | null;
  sellOfferCount: number | null;
  buyOrderCount: number | null;
  instantBuyActivity7d: number | null;
  instantSellActivity7d: number | null;
  upstreamAt: number;
  observedAt: number;
  priceChangePct: number | null;
  feeContext?: FeeContext;
}
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ItemVariant {
  version: 1;
  fingerprint: string;
  itemId: string;
  name: string;
  quantity: number;
  rarity: string;
  category: string;
  enchantments: Record<string, number>;
  modifiers: Record<string, Json>;
  complete: boolean;
  issues: string[];
}
export interface Listing {
  id: string;
  seller?: string;
  sellerName?: string;
  variant: ItemVariant;
  price: number;
  start: number;
  end: number;
  upstreamAt: number;
  observedAt: number;
  status: "active" | "sold" | "expired" | "unavailable" | "stale";
}
export interface Valuation {
  basis?: "active-listings";
  listings?: {
    id: string;
    price: number;
    end: number;
    seller?: string;
    sellerName?: string;
    excluded?: string;
  }[];
  arithmeticMean?: number | null;
  sellerCount?: number;
  largestSellerShare?: number;
  confidence: Confidence;
  reasons: string[];
  estimate: number | null;
  low: number | null;
  high: number | null;
  median: number | null;
  trimmedMean: number | null;
  dispersion: number | null;
  movement: number | null;
  count: number;
  rawCount: number;
  excludedCount: number;
  windowStart: number;
  windowEnd: number;
  sales: { id: string; price: number; soldAt: number }[];
  match: "exact" | "none";
}
