import type { Level } from "../model";
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
