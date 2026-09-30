import type { AlertEvent, PriceAlertInput, Workflow } from "./model.js";
import { positive } from "./workflow.js";

export function updatePriceAlertTarget(w: Workflow, target: number, revision: number, now: number): Workflow {
  positive(target, "Target price");
  if (w.mode !== "single" || w.paused || !["watching_buy", "watching_sell"].includes(w.stage))
    throw new Error("This alert is no longer active. Create a new alert to watch another target.");
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid alert revision.");
  const current = w.stage === "watching_buy" ? w.buyTarget : w.sellTarget;
  // A retry after a lost response must not make another revision.
  if (w.revision === revision + 1 && current === target) return w;
  if (w.revision !== revision) throw new Error("This alert changed elsewhere. Refresh your alerts and try again.");
  if (current === target) return w;
  return { ...w, buyTarget: target, sellTarget: target, revision: w.revision + 1, updatedAt: now };
}

export function validatePriceAlert(input: PriceAlertInput) {
  if (!input || typeof input !== "object") throw new Error("Invalid alert.");
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId ?? ""))
    throw new Error("Invalid request ID.");
  if (
    typeof input.itemId !== "string" ||
    !/^[A-Za-z0-9_:\-]{1,100}$/.test(input.itemId)
  )
    throw new Error("Invalid item.");
  if (input.side !== "buy" && input.side !== "sell")
    throw new Error("Choose a buy or sell alert.");
  if (
    !Number.isFinite(input.taxRate) ||
    input.taxRate < 0 ||
    input.taxRate >= 100
  )
    throw new Error("Tax must be between 0 and 99.99%.");
  return {
    quantity: positive(input.quantity, "Quantity", true),
    target: positive(input.target, "Target price"),
    taxRate: input.taxRate,
  };
}

export function newPriceAlert(
  id: string,
  name: string,
  input: PriceAlertInput,
  now: number,
): Workflow {
  const values = validatePriceAlert(input);
  return {
    id,
    itemId: input.itemId,
    itemName: name,
    mode: "single",
    quantity: values.quantity,
    taxRate: values.taxRate,
    buyTarget: values.target,
    sellTarget: values.target,
    stage: input.side === "buy" ? "watching_buy" : "watching_sell",
    paused: false,
    channels: ["email"],
    generation: 0,
    revision: 0,
    purchaseCost: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function confirmation(
  w: Workflow,
  disableUrl: string,
  now: number,
): AlertEvent {
  const buy = w.stage === "watching_buy";
  const coins = (v: number) =>
    v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return {
    id: `${w.id}-created`,
    workflowId: w.id,
    itemName: w.itemName,
    side: "created",
    createdAt: now,
    marketTimestamp: 0,
    pending: true,
    message: [
      `BazaarSignal: alert created for ${w.itemName}`,
      "",
      "Your price alert is active.",
      `Item: ${w.itemName}`,
      `Quantity: ${coins(w.quantity)}`,
      `Notify me when the ${buy ? "instant-buy cost is at or below" : "instant-sell proceeds are at or above"} ${coins(buy ? w.buyTarget : w.sellTarget)} coins per item${buy ? "" : ` after ${w.taxRate}% tax`}.`,
      "We check the estimated price for your entire quantity and email you once when your target is reached.",
      "",
      "Disable this alert:",
      disableUrl,
      "Open the link, then select Disable alert. No sign-in is required. Keep this link private.",
      "",
      "Prices are estimates. All trades are made manually in Minecraft.",
    ].join("\n"),
    deliveries: {
      email: {
        status: "queued",
        attempts: 0,
        nextAttempt: now,
        leaseUntil: 0,
        error: null,
      },
    },
  };
}
