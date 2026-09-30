import type { Action, Settings, Workflow } from "./model.js";
export function positive(
  value: unknown,
  name: string,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1e15 ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error(
      `${name} must be a positive ${integer ? "whole number" : "number"}.`,
    );
  return value;
}
export function channels(value: unknown) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((c) => c !== "email" && c !== "discord")
  )
    throw new Error("Choose at least one notification channel.");
  return [...new Set(value)] as Workflow["channels"];
}
export function validateTargets(
  a: Extract<Action, { type: "create" | "edit" }>,
) {
  return {
    quantity: positive(a.quantity, "Quantity", true),
    buyTarget: positive(a.buyTarget, "Buy target"),
    sellTarget: positive(a.sellTarget, "Sell target"),
    channels: channels(a.channels),
  };
}
export function updateWorkflow(
  w: Workflow,
  action: Action,
  now: number,
): Workflow {
  let next = { ...w };
  if (action.type === "edit") {
    const values = validateTargets(action);
    if (w.purchaseCost !== null && values.quantity !== w.quantity)
      throw new Error("Quantity is locked after confirming a purchase.");
    next = { ...next, ...values };
  } else if (action.type === "confirmPurchase") {
    if (w.stage !== "awaiting_purchase" && w.stage !== "watching_buy")
      throw new Error("This purchase has already been confirmed.");
    next = {
      ...next,
      quantity: positive(action.quantity, "Quantity", true),
      purchaseCost: positive(action.purchaseCost, "Total purchase cost"),
      stage: "watching_sell",
      paused: false,
      generation: w.generation + 1,
    };
  } else if (action.type === "pause") next.paused = !w.paused;
  else if (action.type === "rearm") {
    next = {
      ...next,
      stage: w.purchaseCost === null ? "watching_buy" : "watching_sell",
      paused: false,
      generation: w.generation + 1,
    };
  } else throw new Error("Unsupported workflow action.");
  return { ...next, revision: w.revision + 1, updatedAt: now };
}
export function validateSettings(
  action: Extract<Action, { type: "settings" }>,
  previous: Settings,
): Settings {
  if (
    typeof action.taxRate !== "number" ||
    !Number.isFinite(action.taxRate) ||
    action.taxRate < 0 ||
    action.taxRate > 100
  )
    throw new Error("Tax rate must be between 0 and 100.");
  for (const key of [
    "emailEnabled",
    "discordEnabled",
    "monitoringPaused",
  ] as const)
    if (typeof action[key] !== "boolean") throw new Error("Invalid setting.");
  if (action.discordEnabled && !previous.discordTested)
    throw new Error("Send a successful Discord test before enabling DMs.");
  return {
    ...previous,
    taxRate: action.taxRate,
    emailEnabled: action.emailEnabled,
    discordEnabled: action.discordEnabled,
    monitoringPaused: action.monitoringPaused,
  };
}
