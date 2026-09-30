import { evaluate } from "../../shared/market.js";
import type {
  AlertEvent,
  Book,
  Channel,
  Delivery,
  Settings,
  Workflow,
} from "../../shared/model.js";
export function trigger(
  w: Workflow,
  book: Book | undefined,
  timestamp: number,
  settings: Settings,
  url: string,
  now: number,
): { workflow: Workflow; event: AlertEvent } | null {
  if (settings.monitoringPaused) return null;
  const selected = w.channels.filter((c) =>
    c === "email"
      ? settings.emailEnabled
      : settings.discordEnabled && settings.discordTested,
  );
  if (!selected.length) return null;
  const quote = evaluate(w, book, timestamp, settings.taxRate, now);
  if (!quote) return null;
  const id = `${w.id}-${w.generation}-${quote.side}`;
  const deliveries: Partial<Record<Channel, Delivery>> = {};
  for (const channel of selected)
    deliveries[channel] = {
      status: "queued",
      attempts: 0,
      nextAttempt: now,
      leaseUntil: 0,
      error: null,
    };
  const coins = (v: number) =>
    v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const lines = [
    `${w.itemName}: ${quote.side === "buy" ? "buy" : "sell"} target reached`,
    `Quantity: ${coins(w.quantity)}`,
    `Target: ${coins(quote.side === "buy" ? w.buyTarget : w.sellTarget)} coins/item${quote.side === "sell" ? " after tax" : ""}`,
    `Estimated ${quote.side === "buy" ? "cost" : "net proceeds"}: ${coins(quote.total)} coins (${coins(quote.unit)}/item)`,
    ...(quote.side === "sell" && w.purchaseCost !== null
      ? [
          `Estimated profit: ${coins(quote.total - w.purchaseCost)} coins. Tax: ${settings.taxRate}%`,
        ]
      : []),
    `Market snapshot: ${new Date(timestamp).toISOString()}`,
    "Prices can change. Trade manually in Minecraft.",
    url,
  ];
  return {
    workflow: {
      ...w,
      stage:
        w.mode === "single" || quote.side === "sell"
          ? "completed"
          : "awaiting_purchase",
      revision: w.revision + 1,
      updatedAt: now,
    },
    event: {
      id,
      workflowId: w.id,
      itemName: w.itemName,
      side: quote.side,
      createdAt: now,
      marketTimestamp: timestamp,
      message: lines.join("\n"),
      pending: true,
      deliveries,
    },
  };
}
