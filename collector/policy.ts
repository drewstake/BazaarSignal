export interface MarketPolicy {
  windowMs: number;
  requestLimit: number;
  reserve: number;
  bazaarMs: number;
  auctionMinMs: number;
  catalogMs: number;
  electionMs: number;
  leaseMs: number;
  timeoutMs: number;
  maxRetries: number;
  staleMs: number;
}
export const defaultPolicy: MarketPolicy = {
  windowMs: 300_000,
  requestLimit: 120,
  reserve: 0.2,
  bazaarMs: 60_000,
  auctionMinMs: 120_000,
  catalogMs: 86400_000,
  electionMs: 300_000,
  leaseMs: 60_000,
  timeoutMs: 12_000,
  maxRetries: 2,
  staleMs: 180_000,
};
export function configuredPolicy(): MarketPolicy {
  const p = { ...defaultPolicy };
  for (const [env, key] of Object.entries({
    HYPIXEL_REQUEST_LIMIT: "requestLimit",
    HYPIXEL_WINDOW_MS: "windowMs",
    HYPIXEL_RESERVE: "reserve",
    MARKET_BAZAAR_MS: "bazaarMs",
    MARKET_AUCTION_MIN_MS: "auctionMinMs",
  }) as [string, keyof MarketPolicy][])
    if (process.env[env]) p[key] = Number(process.env[env]);
  if (
    !Number.isSafeInteger(p.requestLimit) ||
    p.requestLimit < 10 ||
    p.requestLimit > 10000 ||
    !Number.isSafeInteger(p.windowMs) ||
    p.windowMs < 60000 ||
    p.windowMs > 3600000 ||
    !Number.isFinite(p.reserve) ||
    p.reserve < 0.2 ||
    p.reserve > 0.8 ||
    !Number.isFinite(p.bazaarMs) ||
    p.bazaarMs < 60000 ||
    !Number.isFinite(p.auctionMinMs) ||
    p.auctionMinMs < 60000
  )
    throw new Error(
      "Invalid market request budget/interval configuration (reserve must be at least 20%).",
    );
  return p;
}
export const routineLimit = (p: MarketPolicy) =>
  Math.floor(p.requestLimit * (1 - p.reserve));
export function auctionInterval(
  p: MarketPolicy,
  pages: number,
  duration: number,
  cadence = 60000,
) {
  const other =
    Math.ceil(p.windowMs / p.bazaarMs) +
    Math.ceil(p.windowMs / p.electionMs) +
    1;
  const capacity = Math.max(1, routineLimit(p) - other);
  return (
    Math.ceil(
      Math.max(
        p.auctionMinMs,
        cadence,
        duration + 5000,
        (pages * p.windowMs) / capacity,
      ) / 1000,
    ) * 1000
  );
}
export const backoff = (failures: number, random = Math.random) =>
  Math.min(300000, 5000 * 2 ** Math.min(6, Math.max(0, failures - 1))) *
  (0.8 + random() * 0.2);
export function retryAfter(value: string | null, now: number) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? now + Math.max(0, seconds) * 1000
    : Math.max(now, Date.parse(value) || 0);
}
