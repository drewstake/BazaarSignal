/** UTC clock slots shared by the collector, browsers and alert worker. */
export const MARKET_HOUR = 3_600_000;
export const MARKET_REFRESH_MS = 5 * 60_000;
export const MARKET_COLLECTION_SCHEDULE = '*/5 * * * *';
export const MARKET_READ_OFFSET = 120_000;
export const marketReadSlot = (at: number, interval = MARKET_REFRESH_MS) =>
  Math.floor((at - MARKET_READ_OFFSET) / interval);
export const nextMarketRead = (after: number, interval = MARKET_REFRESH_MS) =>
  (marketReadSlot(after, interval) + 1) * interval + MARKET_READ_OFFSET;
// A minute trigger lands once in this 60-second window, after Bazaar publication
// but before its three-minute freshness deadline. Delays still fail freshness.
export const marketAlertWindow = (at: number) => {
  const phase = at % MARKET_REFRESH_MS;
  return phase >= MARKET_READ_OFFSET - 30_000 && phase < MARKET_READ_OFFSET + 30_000;
};
