import {
  historyDay,
  historyPrice,
  validHistoryItem,
  type DailyPrice,
  type HistorySource,
} from "../shared/daily-price-history";

/** Reduce BEFORE writing: one actual observation per item/day/source, no interpolation.
 * In a tie the first tuple wins; input order is stable and documented by the importer. */
export function dailyReducer(
  source: HistorySource,
  reference: string,
  now = Date.now(),
) {
  const rows = new Map<string, DailyPrice>();
  let observations = 0;
  const add = (item: string, at: number, buy: unknown, sell: unknown) => {
    if (
      !validHistoryItem(item) ||
      !Number.isSafeInteger(at) ||
      at < Date.UTC(2020, 2, 1) ||
      at > now
    )
      return;
    const b = historyPrice(buy),
      s = historyPrice(sell);
    // An observation with both sides missing is retained: it must break both lines.
    const day = historyDay(at),
      key = `${item}/${day}`;
    observations++;
    const old = rows.get(key);
    if (!old || at > old.at)
      rows.set(key, { item, day, at, buy: b, sell: s, source, reference });
  };
  return { add, rows, count: () => observations };
}

export function decodeSkytrack(
  item: string,
  input: any,
  reference: string,
  now = Date.now(),
) {
  if (!input?.bazaar || typeof input.bazaar !== "object")
    throw new Error("Missing Skytrack Bazaar history");
  const result = dailyReducer("skytrack", reference, now);
  // Prefer raw over thinned tiers when timestamps overlap.
  for (const tier of ["raw", "hourly", "daily"]) {
    const tuples = input.bazaar[tier];
    if (!Array.isArray(tuples) || tuples.length > 1_000_000)
      throw new Error(`Invalid Skytrack ${tier}`);
    for (const tuple of tuples) {
      if (
        !Array.isArray(tuple) ||
        tuple.length < 3 ||
        typeof tuple[0] !== "number"
      )
        throw new Error("Invalid Skytrack tuple");
      result.add(item, Math.round(tuple[0] * 1000), tuple[1], tuple[2]);
    }
  }
  return result;
}

/** Decode only public Bazaar price columns, never executable code or player data.
 * delta2: timestamps/poll indices are cumulative; price deltas are per item,
 * in centicoins. Null does not advance the per-item price reference. */
export function decodeBazaarCalc(
  input: any,
  reference: string,
  now = Date.now(),
) {
  if (input?.format !== "bazaar-calc-data/1" || input.encoding !== "delta2")
    throw new Error("Unsupported Bazaar Calc format");
  const { polls, items, closes } = input;
  if (
    !Array.isArray(polls) ||
    !Array.isArray(items) ||
    polls.length > 2_000_000 ||
    items.length > 20_000 ||
    !closes ||
    !Array.isArray(closes.item) ||
    closes.item.length > 2_000_000 ||
    ["poll", "ask", "bid"].some(
      (k) =>
        !Array.isArray(closes[k]) || closes[k].length !== closes.item.length,
    )
  )
    throw new Error("Invalid Bazaar Calc columns");
  let stamp = 0;
  const times = polls.map((delta: unknown) => {
    if (!Number.isSafeInteger(delta)) throw new Error("Invalid poll delta");
    stamp += delta as number;
    if (!Number.isSafeInteger(stamp)) throw new Error("Invalid poll timestamp");
    return stamp;
  });
  const result = dailyReducer("bazaar-calc", reference, now);
  const asks = new Map<number, number>(),
    bids = new Map<number, number>();
  const price = (delta: unknown, item: number, last: Map<number, number>) => {
    if (delta === null) return null;
    if (!Number.isSafeInteger(delta)) throw new Error("Invalid price delta");
    const absolute = (last.get(item) ?? 0) + (delta as number);
    if (!Number.isSafeInteger(absolute) || absolute < 0)
      throw new Error("Invalid absolute price");
    last.set(item, absolute);
    return absolute / 100;
  };
  let poll = 0;
  for (let i = 0; i < closes.item.length; i++) {
    const item = closes.item[i],
      delta = closes.poll[i];
    if (
      !Number.isInteger(item) ||
      item < 0 ||
      item >= items.length ||
      !Number.isSafeInteger(delta)
    )
      throw new Error("Invalid close index");
    poll += delta;
    if (!Number.isSafeInteger(poll) || poll < 0 || poll >= times.length)
      throw new Error("Invalid poll index");
    result.add(
      items[item],
      times[poll],
      price(closes.ask[i], item, asks),
      price(closes.bid[i], item, bids),
    );
  }
  return result;
}
