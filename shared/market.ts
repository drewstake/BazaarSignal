import type { Book, Level, Workflow } from "./model.js";
export const STALE_MS = 180_000;
// Display validity is independent of eligibility for a fresh target evaluation.
export const isValidSample = (stamp: number, now = Date.now()) =>
  Number.isFinite(stamp) && stamp > 0 && stamp <= now + 30_000;
export const isFresh = (stamp: number, now = Date.now()) =>
  isValidSample(stamp, now) &&
  now - stamp <= STALE_MS;
export function parseLevels(raw: unknown): Level[] {
  if (!Array.isArray(raw) || raw.length > 30)
    throw new Error("Invalid book depth");
  return raw.map((v: unknown) => {
    if (!v || typeof v !== "object") throw new Error("Invalid price level");
    const x = v as Level;
    if (
      ![x.amount, x.pricePerUnit, x.orders].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      ) ||
      x.amount <= 0 ||
      x.pricePerUnit <= 0 ||
      x.orders <= 0
    )
      throw new Error("Invalid price level");
    return { amount: x.amount, pricePerUnit: x.pricePerUnit, orders: x.orders };
  });
}
export function parseBook(raw: unknown): Book {
  if (!raw || typeof raw !== "object") throw new Error("Missing product");
  const p = raw as Record<string, unknown>;
  return {
    buy: parseLevels(p.buy_summary).sort(
      (a, b) => a.pricePerUnit - b.pricePerUnit,
    ),
    sell: parseLevels(p.sell_summary).sort(
      (a, b) => b.pricePerUnit - a.pricePerUnit,
    ),
  };
}
export function estimate(
  book: Book | undefined,
  quantity: number,
  side: "buy" | "sell",
  taxRate = 1.25,
) {
  if (
    !book ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(taxRate) ||
    taxRate < 0 ||
    taxRate > 100
  )
    return null;
  let remaining = quantity,
    gross = 0;
  if (!Array.isArray(book[side])) return null;
  for (const level of book[side]) {
    if (![level.amount, level.pricePerUnit, level.orders].every(n => Number.isFinite(n) && n > 0)) return null;
    const amount = Math.min(remaining, level.amount);
    gross += amount * level.pricePerUnit;
    remaining -= amount;
    if (remaining <= 0) break;
  }
  if (remaining > 0 || !Number.isFinite(gross)) return null;
  const total = side === "sell" ? gross * (1 - taxRate / 100) : gross;
  return { total, unit: total / quantity, gross };
}
export function evaluate(
  workflow: Workflow,
  book: Book | undefined,
  timestamp: number,
  taxRate: number,
  now = Date.now(),
) {
  if (
    workflow.paused ||
    !isFresh(timestamp, now) ||
    !["watching_buy", "watching_sell"].includes(workflow.stage)
  )
    return null;
  const side: "buy" | "sell" =
    workflow.stage === "watching_buy" ? "buy" : "sell";
  const quote = estimate(
    book,
    workflow.quantity,
    side,
    workflow.taxRate ?? taxRate,
  );
  if (
    !quote ||
    (side === "buy"
      ? quote.unit > workflow.buyTarget
      : quote.unit < workflow.sellTarget)
  )
    return null;
  return { side, ...quote };
}
