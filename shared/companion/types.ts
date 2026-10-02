import type { Level } from "../model";

export type Strategy = "order-offer" | "instant-offer" | "order-instant";
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
export interface BazaarFilters {
  query: string;
  category: string;
  strategy: Strategy;
  quantity: number;
  budget: number;
  minProfit: number;
  minRoi: number;
  minBuyActivity: number;
  minSellActivity: number;
  minBothActivity: number;
  maxActivityShare: number;
  minDepth: number;
  maxAgeSeconds: number;
  liquidity: "all" | "balanced" | "strong";
  sort: "profit" | "unit" | "roi" | "activity" | "capital" | "balanced";
  taxPercent: number;
  executionCost: number;
  view: "cards" | "list";
}
export interface BazaarQuote {
  item: BazaarItem;
  strategy: Strategy;
  quantity: number;
  acquisitionUnit: number;
  exitUnit: number;
  acquisition: number;
  grossSale: number;
  tax: number;
  executionCost: number;
  netSale: number;
  profit: number;
  unitProfit: number;
  capital: number;
  roi: number;
  activityShare: number | null;
  depth: number;
  liquidity: "thin" | "balanced" | "strong";
  concerns: string[];
  fresh: boolean;
  waits: string;
  slippage: number;
  supported: boolean;
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
export interface Sale {
  id: string;
  variant: ItemVariant;
  price: number;
  soldAt: number;
  observedAt: number;
  seller: string;
  buyer: string;
  source: "hypixel-ended";
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
export interface AuctionOpportunity {
  /** Filtered candidates and unfiltered cached evidence for this canonical item. */
  group?: { matchingListings: Listing[]; comparisonPool: Listing[] };
  listing: Listing;
  valuation: Valuation;
  /** Exact-match asking prices evaluated when the cached snapshot was observed. */
  sampledValuation?: Valuation;
  fees: {
    listing: number;
    duration: number;
    claim: number;
    total: number;
  } | null;
  profit: number | null;
  roi: number | null;
  capital: number;
  flags: string[];
  feeContext?: FeeContext;
}
export interface AuctionFilters {
  query: string;
  category: string;
  rarity: string;
  budget: number;
  minProfit: number;
  minRoi: number;
  minComps: number;
  confidence: Confidence;
  requiredEnchant: string;
  excludedEnchant: string;
  enchantLevel: number;
  upgrade: string;
  maxAgeMinutes: number;
  hideFlagged: boolean;
  showInsufficient: boolean;
  durationHours: number;
  sort: "supported" | "profit" | "roi" | "capital" | "confidence" | "recent";
  view: "cards" | "list";
}
export interface CollectorHealth {
  mode: "local" | "firestore" | "shared";
  startedAt: number;
  lastEndedSuccess: number;
  lastActiveSuccess: number;
  endedUpstreamAt: number;
  activeUpstreamAt: number;
  missedMs: number;
  gaps: { from: number; to: number }[];
  saleCount: number;
  variantCount: number;
  listingCount: number;
  rejectedCount: number;
  error: string | null;
  scope: string[];
  writesToday: number;
  writeLimit: number;
  writeDay?: string;
}
