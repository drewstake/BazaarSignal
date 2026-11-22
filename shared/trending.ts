export const trendHours = [1, 6, 24] as const;
export type TrendHours = (typeof trendHours)[number];
export const trendLimit = 50;
export const trendLiquidity = {
  weeklyUnitsPerSide: 700,
  nearPricePct: 5,
  unitsPerSide: 10,
  ordersPerSide: 3,
  maxSpreadPct: 20,
} as const;

export interface TrendRow {
  id: string;
  name: string;
  offerBefore: number;
  offer: number;
  offerChange: number;
  bidChange: number;
  buyActivity7d: number;
  sellActivity7d: number;
}

export interface TrendWindow {
  hours: TrendHours;
  baselineAt: number | null;
  gainers: number;
  rows: TrendRow[];
}

export interface TrendBoard {
  version: 2;
  at: number;
  items: number;
  windows: TrendWindow[];
}
