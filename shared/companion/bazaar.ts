import { parseBook, isFresh, isValidSample } from "../market";
import type { Level } from "../model";
import { bazaarTax } from "./fees";
import type { BazaarFilters, BazaarItem, BazaarQuote, Strategy } from "./types";

export const strategyLabels: Record<Strategy, string> = {
  "order-offer": "Buy order → sell offer",
  "instant-offer": "Instant buy → sell offer",
  "order-instant": "Buy order → instant sell",
};
export const defaultBazaarFilters: BazaarFilters = {
  query: "",
  category: "all",
  strategy: "order-offer",
  quantity: 64,
  budget: 10_000_000,
  minProfit: 0,
  minRoi: 0,
  minBuyActivity: 0,
  minSellActivity: 0,
  minBothActivity: 1000,
  maxActivityShare: 1,
  minDepth: 64,
  maxAgeSeconds: 180,
  liquidity: "balanced",
  sort: "profit",
  taxPercent: 1.25,
  executionCost: 0,
  view: "cards",
};
const metric = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
export function categoryFor(id: string, supplied?: string) {
  if (supplied) return supplied.toLowerCase();
  if (/ENCHANTMENT|BOOK/.test(id)) return "enchantments";
  if (
    /WHEAT|CARROT|POTATO|SUGAR|MELON|PUMPKIN|SEED|CACTUS|COCOA|MUSHROOM|WART/.test(
      id,
    )
  )
    return "farming";
  if (
    /DIAMOND|GOLD|IRON|COAL|LAPIS|REDSTONE|EMERALD|MITHRIL|TITANIUM|GEM|STONE|QUARTZ/.test(
      id,
    )
  )
    return "mining";
  if (/FISH|SALMON|PUFFER|SHARK|BAIT/.test(id)) return "fishing";
  if (/LOG|WOOD/.test(id)) return "foraging";
  if (/EYE|BLAZE|FLESH|BONE|PEARL|STRING|POWDER/.test(id)) return "combat";
  return "other";
}
export function normalizeBazaar(
  id: string,
  raw: unknown,
  upstreamAt: number,
  observedAt: number,
  catalog?: { name?: string; category?: string; tier?: string },
  previous?: BazaarItem,
): BazaarItem {
  const book = parseBook(raw);
  const q =
    (raw as { quick_status?: Record<string, unknown> }).quick_status ?? {};
  // Hypixel uses transaction-side names: buy_summary are asks consumed by instant
  // buyers; sell_summary are bids consumed by instant sellers. Never reverse these.
  const old = previous?.asks[0]?.pricePerUnit,
    current = book.buy[0]?.pricePerUnit;
  return {
    id,
    name:
      catalog?.name?.replace(/§./g, "") ??
      id
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    category: categoryFor(id, catalog?.category),
    rarity: catalog?.tier ?? "UNKNOWN",
    asks: book.buy,
    bids: book.sell,
    openSellQuantity: metric(q.buyVolume),
    openBuyQuantity: metric(q.sellVolume),
    sellOfferCount: metric(q.buyOrders),
    buyOrderCount: metric(q.sellOrders),
    instantBuyActivity7d: metric(q.buyMovingWeek),
    instantSellActivity7d: metric(q.sellMovingWeek),
    upstreamAt,
    observedAt,
    priceChangePct:
      old && current && previous && upstreamAt > previous.upstreamAt
        ? (current / old - 1) * 100
        : (previous?.priceChangePct ?? null),
  };
}
export function executeDepth(levels: Level[], quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  let remaining = quantity,
    total = 0;
  for (const level of levels) {
    if (
      ![level.amount, level.pricePerUnit, level.orders].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    )
      return null;
    const take = Math.min(remaining, level.amount);
    total += take * level.pricePerUnit;
    remaining -= take;
    if (!Number.isFinite(total)) return null;
    if (!remaining)
      return {
        total,
        unit: total / quantity,
        slippage:
          Math.abs(total / quantity - levels[0].pricePerUnit) * quantity,
      };
  }
  return null; // Never extrapolate beyond visible levels.
}
export function validBazaarSample(item: BazaarItem, now = Date.now()) {
  return isValidSample(item.upstreamAt, now) && isValidSample(item.observedAt, now) &&
    isFresh(item.upstreamAt, item.observedAt);
}
/** Independently price each leg; never manufacture the other side of a book. */
export function bazaarTrade(item: BazaarItem, f: BazaarFilters, now = Date.now()) {
  const valid = validBazaarSample(item, now) && Number.isSafeInteger(f.quantity) && f.quantity > 0;
  const passive = (levels: Level[]) => {
    const top = executeDepth(levels.slice(0, 1), 1);
    const total = top ? top.unit * f.quantity : NaN;
    return Number.isFinite(total) ? { total, unit: top!.unit, slippage: 0 } : null;
  };
  return {
    buy: !valid ? null : f.strategy === 'instant-offer' ? executeDepth(item.asks, f.quantity) : passive(item.bids),
    sale: !valid ? null : f.strategy === 'order-instant' ? executeDepth(item.bids, f.quantity) : passive(item.asks),
  };
}
export function sampledFeesReady(item: BazaarItem, now = Date.now()) {
  const fee = item.feeContext;
  // A price sample needs explicit compatible fee evidence for profit.
  return !!fee && (isValidSample(fee.checkedAt, now) &&
    Math.abs(item.observedAt - fee.checkedAt) < 600_000 &&
    fee.multiplier !== null && Number.isFinite(fee.multiplier) && fee.multiplier > 0);
}
export function quoteBazaar(
  item: BazaarItem,
  f: BazaarFilters,
  now = Date.now(),
): BazaarQuote | null {
  const qty = f.quantity,
    ask = item.asks[0]?.pricePerUnit,
    bid = item.bids[0]?.pricePerUnit;
  if (
    !ask ||
    !bid ||
    !Number.isSafeInteger(qty) ||
    qty < 1 ||
    !Number.isFinite(f.executionCost) ||
    f.executionCost < 0 ||
    !Number.isFinite(f.taxPercent) ||
    f.taxPercent < 0 ||
    f.taxPercent > 100
  )
    return null;
  // Passive orders join the current best price. No unmodeled outbidding premium.
  const { buy, sale } = bazaarTrade(item, f, now);
  if (!buy || !sale) return null;
  const feeReady = sampledFeesReady(item, now);
  if (!feeReady || f.taxPercent * (item.feeContext?.multiplier ?? 1) > 100) return null;
  const tax = bazaarTax(
      sale.total,
      f.taxPercent * (item.feeContext?.multiplier ?? 1),
    ),
    netSale = sale.total - tax;
  const capital = buy.total + f.executionCost,
    profit = netSale - capital;
  if (![capital, profit, netSale, tax].every(Number.isFinite) || capital <= 0) return null;
  const buyActivity = item.instantBuyActivity7d,
    sellActivity = item.instantSellActivity7d;
  const supported =
    feeReady &&
    buyActivity !== null &&
    sellActivity !== null &&
    item.openBuyQuantity !== null &&
    item.openSellQuantity !== null;
  const minActivity = supported ? Math.min(buyActivity!, sellActivity!) : 0;
  const activityShare = minActivity > 0 ? (qty / minActivity) * 100 : null;
  const depth = Math.min(
    item.asks.reduce((n, l) => n + l.amount, 0),
    item.bids.reduce((n, l) => n + l.amount, 0),
  );
  const fresh =
    isFresh(item.upstreamAt, now) &&
    now - item.upstreamAt <= f.maxAgeSeconds * 1000;
  const concerns: string[] = [];
  if (!feeReady)
    concerns.push(
      "Current mayor fee modifiers could not be verified; standard-tax calculation is illustrative only.",
    );
  if (!fresh) concerns.push("Last sampled estimate · stale prices; not a current opportunity.");
  if (!supported)
    concerns.push("Insufficient activity or outstanding-order data.");
  if (minActivity < 1000)
    concerns.push("Thin market: fewer than 1,000 reported units on a side.");
  if (activityShare === null || activityShare > f.maxActivityShare)
    concerns.push(
      "Your quantity is large relative to the weaker weekly activity proxy.",
    );
  if (depth < qty)
    concerns.push(
      "Visible depth is smaller than your planned quantity; passive fill is uncertain.",
    );
  if (ask / bid - 1 > 0.5)
    concerns.push("Unusual spread above 50%; inspect market depth carefully.");
  if (item.priceChangePct !== null && Math.abs(item.priceChangePct) > 15)
    concerns.push(
      "Price moved more than 15% since the previous observed snapshot.",
    );
  const liquidity =
    !supported ||
    minActivity < 1000 ||
    activityShare === null ||
    activityShare > 1 ||
    depth < qty
      ? "thin"
      : minActivity >= 100_000 && activityShare <= 0.1
        ? "strong"
        : "balanced";
  return {
    item,
    quantity: qty,
    strategy: f.strategy,
    acquisitionUnit: buy.unit,
    exitUnit: sale.unit,
    acquisition: buy.total,
    grossSale: sale.total,
    tax,
    executionCost: f.executionCost,
    netSale,
    profit,
    unitProfit: profit / qty,
    capital,
    roi: (profit / capital) * 100,
    activityShare,
    depth,
    liquidity,
    concerns,
    fresh,
    supported,
    slippage: buy.slippage + sale.slippage,
    waits:
      f.strategy === "order-offer"
        ? "Wait for both your buy order and sell offer to fill."
        : f.strategy === "instant-offer"
          ? "Buy immediately; wait for your sell offer to fill."
          : "Wait for your buy order; then sell into visible bids.",
  };
}
export function filterBazaar(
  items: BazaarItem[],
  f: BazaarFilters,
  now = Date.now(),
  includeSampled = false,
) {
  return items
    .flatMap((item) => {
      if (
        !`${item.name} ${item.id}`
          .toLowerCase()
          .includes(f.query.toLowerCase().trim()) ||
        (f.category !== "all" && item.category !== f.category)
      )
        return [];
      const q = quoteBazaar(item, f, now);
      if (
        !q ||
        (!q.fresh && !includeSampled) ||
        !q.supported ||
        q.capital > f.budget ||
        q.profit < f.minProfit ||
        q.roi < f.minRoi ||
        (item.instantBuyActivity7d ?? 0) <
          Math.max(f.minBuyActivity, f.minBothActivity) ||
        (item.instantSellActivity7d ?? 0) <
          Math.max(f.minSellActivity, f.minBothActivity) ||
        q.activityShare === null ||
        q.activityShare > f.maxActivityShare ||
        q.depth < f.minDepth ||
        (f.liquidity === "strong" && q.liquidity !== "strong") ||
        (f.liquidity === "balanced" && q.liquidity === "thin")
      )
        return [];
      return [q];
    })
    .sort((a, b) => {
      const score = (q: BazaarQuote) =>
        f.sort === "unit"
          ? q.unitProfit
          : f.sort === "roi"
            ? q.roi
            : f.sort === "capital"
              ? -q.capital
              : f.sort === "activity"
                ? Math.min(
                    q.item.instantBuyActivity7d!,
                    q.item.instantSellActivity7d!,
                  )
                : f.sort === "balanced"
                  ? q.profit /
                    (1 + (q.activityShare ?? 100) + q.concerns.length)
                  : q.profit;
      return score(b) - score(a) || a.item.id.localeCompare(b.item.id);
    });
}
